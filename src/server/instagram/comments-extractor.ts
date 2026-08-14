import { logger } from "./logger";
import { retryProxyFetch } from "./proxy-helper";
import { acquireToken } from "./rate-limiter";

const MOBILE_IG_APP_ID = "567067343352427";
const REQUEST_DELAY_MS = 500;
const MAX_REQUESTS_PER_MEDIA = Infinity;

export interface CommenterInfo {
  username: string;
  fullName: string;
  profilePicUrl: string;
  isVerified: boolean;
  isPrivate: boolean;
}

export interface CommentsPageResult {
  commenters: CommenterInfo[];
  nextMaxId: string | null;
  hasMore: boolean;
  commentCount: number;
}

export interface MediaInfo {
  mediaId: string;
  shortcode: string;
  ownerUsername: string;
  commentCount: number;
}

const SHORTCODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function decodeShortcode(shortcode: string): string {
  let mediaId = BigInt(0);
  for (const char of shortcode) {
    const idx = SHORTCODE_ALPHABET.indexOf(char);
    if (idx === -1) throw new Error(`Invalid shortcode character: ${char}`);
    mediaId = mediaId * BigInt(64) + BigInt(idx);
  }
  return mediaId.toString();
}

export function parseShortcodes(input: string): string[] {
  const urls = input.split(/[\s,;]+/).filter(Boolean);
  const seen = new Set<string>();
  const shortcodes: string[] = [];
  for (const raw of urls) {
    const urlMatch = raw.match(
      /instagram\.com\/(?:[\w.-]+\/)?(?:p|reel|reels|tv|stories(?:\/[\w.-]+)?)\/([A-Za-z0-9_-]{5,12})/,
    );
    const code = urlMatch
      ? urlMatch[1]
      : /^[A-Za-z0-9_-]{5,12}$/.test(raw.replace(/^https?:\/\//, ""))
        ? raw.replace(/^https?:\/\//, "")
        : null;
    if (code && !seen.has(code)) {
      seen.add(code);
      shortcodes.push(code);
    }
  }
  return shortcodes;
}

function mapCommentUser(user: any): CommenterInfo {
  return {
    username: user.username,
    fullName: user.full_name || "",
    profilePicUrl: user.profile_pic_url || "",
    isVerified: !!user.is_verified,
    isPrivate: !!user.is_private,
  };
}

export type HarvestLogCallback = (entry: {
  kind: "media_info" | "comments_page" | "error";
  shortcode?: string;
  mediaId?: string;
  url?: string;
  params?: Record<string, unknown>;
  status?: number;
  body?: string;
  nextMaxId?: string | null;
  hasMore?: boolean;
  commentersCount?: number;
  error?: string;
  durationMs?: number;
}) => void | Promise<void>;

export async function resolveMediaInfoFromCookies(
  mediaId: string,
  shortcode: string,
  headers: Record<string, string>,
  log?: HarvestLogCallback,
): Promise<MediaInfo | null> {
  const startedAt = Date.now();
  const attempt = async (url: string, extraHeaders: Record<string, string> = {}) => {
    await acquireToken();
    return retryProxyFetch(url, { method: "GET", headers: { ...headers, ...extraHeaders } });
  };

  const webUrl = `https://www.instagram.com/api/v1/media/${mediaId}/info/`;
  let response = await attempt(webUrl);
  let usedUrl = webUrl;

  if (response.status === 302 || response.status === 303) {
    const loc = response.headers.get("location") || "";
    if (loc.includes("login") || loc.includes("accounts")) {
      await log?.({
        kind: "media_info",
        shortcode,
        mediaId,
        url: webUrl,
        status: response.status,
        error: "SESSION_EXPIRED",
        durationMs: Date.now() - startedAt,
      });
      throw new Error("SESSION_EXPIRED");
    }
  }
  if (response.status === 404) {
    await log?.({
      kind: "media_info",
      shortcode,
      mediaId,
      url: webUrl,
      status: 404,
      error: "MEDIA_NOT_FOUND",
      durationMs: Date.now() - startedAt,
    });
    throw new Error("MEDIA_NOT_FOUND");
  }
  if (response.status === 429) {
    await log?.({
      kind: "media_info",
      shortcode,
      mediaId,
      url: webUrl,
      status: 429,
      error: "RATE_LIMITED",
      durationMs: Date.now() - startedAt,
    });
    throw new Error("RATE_LIMITED");
  }
  if (!response.ok) {
    const mobileUrl = `https://i.instagram.com/api/v1/media/${mediaId}/info/`;
    logger.warn(shortcode, `web media info failed (${response.status}) — falling back to mobile endpoint`);
    usedUrl = mobileUrl;
    response = await attempt(mobileUrl, { "x-ig-app-id": MOBILE_IG_APP_ID });
    if (response.status === 429) {
      await log?.({
        kind: "media_info",
        shortcode,
        mediaId,
        url: mobileUrl,
        status: 429,
        error: "RATE_LIMITED",
        durationMs: Date.now() - startedAt,
      });
      throw new Error("RATE_LIMITED");
    }
    if (!response.ok) {
      const body = await response.text();
      logger.warn(shortcode, `media info failed (${response.status}) — continuing with fallback source key`);
      await log?.({
        kind: "media_info",
        shortcode,
        mediaId,
        url: mobileUrl,
        status: response.status,
        body,
        durationMs: Date.now() - startedAt,
      });
      return null;
    }
  }

  const text = await response.text();
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    await log?.({
      kind: "media_info",
      shortcode,
      mediaId,
      url: usedUrl,
      status: response.status,
      body: text,
      durationMs: Date.now() - startedAt,
    });
    return null;
  }
  const item = parsed?.items?.[0];
  if (!item?.user?.username) {
    logger.warn(shortcode, "media info returned unexpected structure — continuing with fallback source key");
    await log?.({
      kind: "media_info",
      shortcode,
      mediaId,
      url: usedUrl,
      status: response.status,
      body: text,
      durationMs: Date.now() - startedAt,
    });
    return null;
  }
  await log?.({
    kind: "media_info",
    shortcode,
    mediaId,
    url: usedUrl,
    status: response.status,
    body: text,
    durationMs: Date.now() - startedAt,
  });
  return {
    mediaId,
    shortcode,
    ownerUsername: item.user.username,
    commentCount: Number(item.comment_count ?? 0),
  };
}

export async function fetchCommentsPageFromCookies(
  mediaId: string,
  headers: Record<string, string>,
  maxId?: string,
  log?: HarvestLogCallback,
): Promise<CommentsPageResult> {
  const params = new URLSearchParams({ can_support_threading: "true" });
  if (maxId) params.set("max_id", maxId);
  const startedAt = Date.now();

  const url = `https://www.instagram.com/api/v1/media/${mediaId}/comments/?${params.toString()}`;
  await acquireToken();
  let response = await retryProxyFetch(url, { method: "GET", headers, redirect: "manual" });
  let usedUrl = url;

  if (response.status === 302 || response.status === 303) {
    const loc = response.headers.get("location") || "";
    if (loc.includes("login") || loc.includes("accounts")) {
      await log?.({
        kind: "comments_page",
        mediaId,
        url,
        params: { max_id: maxId, can_support_threading: true },
        status: response.status,
        error: "SESSION_EXPIRED",
        durationMs: Date.now() - startedAt,
      });
      throw new Error("SESSION_EXPIRED");
    }
  }

  if (response.status === 429) {
    await log?.({
      kind: "comments_page",
      mediaId,
      url,
      params: { max_id: maxId },
      status: 429,
      error: "RATE_LIMITED",
      durationMs: Date.now() - startedAt,
    });
    throw new Error("RATE_LIMITED");
  }

  if (!response.ok) {
    const fallbackUrl = `https://i.instagram.com/api/v1/media/${mediaId}/comments/?${params.toString()}`;
    logger.warn(mediaId, `web comments endpoint failed (${response.status}) — falling back to mobile endpoint`);
    usedUrl = fallbackUrl;
    response = await retryProxyFetch(fallbackUrl, {
      method: "GET",
      headers: { ...headers, "x-ig-app-id": MOBILE_IG_APP_ID },
      redirect: "manual",
    });
    if (response.status === 429) {
      await log?.({
        kind: "comments_page",
        mediaId,
        url: fallbackUrl,
        params: { max_id: maxId },
        status: 429,
        error: "RATE_LIMITED",
        durationMs: Date.now() - startedAt,
      });
      throw new Error("RATE_LIMITED");
    }
  }

  if (!response.ok) {
    const body = await response.text();
    await log?.({
      kind: "comments_page",
      mediaId,
      url: usedUrl,
      params: { max_id: maxId },
      status: response.status,
      body,
      error: "HTTP_ERROR",
      durationMs: Date.now() - startedAt,
    });
    throw new Error(`Instagram API error (${response.status}): ${body.slice(0, 200)}`);
  }

  const text = await response.text();
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    await log?.({
      kind: "comments_page",
      mediaId,
      url: usedUrl,
      params: { max_id: maxId },
      status: response.status,
      body: text,
      error: "NON_JSON",
      durationMs: Date.now() - startedAt,
    });
    throw new Error(`Instagram API returned non-JSON (${response.status}): ${text.slice(0, 300)}`);
  }

  const comments: any[] = Array.isArray(parsed?.comments) ? parsed.comments : [];
  const commenters: CommenterInfo[] = [];
  for (const comment of comments) {
    if (comment?.user) commenters.push(mapCommentUser(comment.user));
    if (Array.isArray(comment?.threaded_comments)) {
      for (const reply of comment.threaded_comments) {
        if (reply?.user) commenters.push(mapCommentUser(reply.user));
      }
    }
  }

  const result: CommentsPageResult = {
    commenters,
    nextMaxId: parsed?.next_max_id || null,
    hasMore: !!parsed?.has_more_comments,
    commentCount: Number(parsed?.comment_count ?? 0),
  };

  await log?.({
    kind: "comments_page",
    mediaId,
    url: usedUrl,
    params: { max_id: maxId, can_support_threading: true },
    status: response.status,
    body: text,
    nextMaxId: result.nextMaxId,
    hasMore: result.hasMore,
    commentersCount: commenters.length,
    durationMs: Date.now() - startedAt,
  });

  return result;
}

export interface CommentsProgressEvent {
  shortcode: string;
  mediaId: string;
  mediaOwner?: string;
  page: number;
  totalPages: number;
  fetchedCount: number;
  estimatedTotal: number;
  commenterUsername?: string;
  commenterFullName?: string;
  avatarUrl?: string;
  isVerified?: boolean;
  isPrivate?: boolean;
  message: string;
}

export type CommentsProgressCallback = (event: CommentsProgressEvent) => void | Promise<void>;

export interface CommentsExtractionResult {
  totalFetched: number;
  mediaProcessed: number;
  mediaFailed: number;
  estimatedTotal: number;
}

export interface CommentsExtractionOptions {
  headers: Record<string, string>;
  shortcodes: string[];
  sourceUsername?: string;
  maxPages?: number;
  signal?: () => boolean | Promise<boolean>;
  log?: HarvestLogCallback;
}

export async function extractCommentersFromCookies(
  options: CommentsExtractionOptions,
  onProgress: CommentsProgressCallback,
): Promise<CommentsExtractionResult> {
  const { headers, shortcodes, maxPages, sourceUsername, log } = options;
  let totalFetched = 0;
  let mediaProcessed = 0;
  let mediaFailed = 0;
  let estimatedTotal = 0;

  for (const shortcode of shortcodes) {
    if (await options.signal?.()) throw new Error("STOPPED");

    let mediaId: string;
    try {
      mediaId = decodeShortcode(shortcode);
    } catch (err: any) {
      logger.warn(shortcode, `Invalid shortcode — ${err.message}`);
      await log?.({
        kind: "error",
        shortcode,
        error: `Invalid shortcode — ${err.message}`,
      });
      mediaFailed++;
      continue;
    }

    let mediaInfo: MediaInfo | null;
    try {
      mediaInfo = await resolveMediaInfoFromCookies(mediaId, shortcode, headers, log);
    } catch (err: any) {
      if (err.message === "MEDIA_NOT_FOUND") {
        logger.warn(shortcode, "Media not found");
        mediaFailed++;
        continue;
      }
      throw err;
    }
    const owner = sourceUsername ?? mediaInfo?.ownerUsername;
    estimatedTotal += mediaInfo?.commentCount ?? 0;
    const totalPages = Math.ceil((mediaInfo?.commentCount ?? 0) / 50);

    let maxId: string | undefined;
    let page = 0;
    let mediaFetched = 0;
    let requestCount = 0;

    while (requestCount < MAX_REQUESTS_PER_MEDIA) {
      if (await options.signal?.()) throw new Error("STOPPED");

      let result: CommentsPageResult;
      try {
        result = await fetchCommentsPageFromCookies(mediaId, headers, maxId, log);
      } catch (err: any) {
        if (err.message?.startsWith?.("RATE_LIMITED")) {
          await log?.({
            kind: "error",
            shortcode,
            mediaId,
            error: `RATE_LIMITED — backoff ${Math.min(60000 * 2 ** requestCount, 300000)}ms`,
          });
          const wait = Math.min(60000 * 2 ** requestCount, 300000);
          await new Promise((r) => setTimeout(r, wait));
          requestCount++;
          continue;
        }
        throw err;
      }
      requestCount++;

      for (const commenter of result.commenters) {
        totalFetched++;
        mediaFetched++;
        await onProgress({
          shortcode,
          mediaId,
          mediaOwner: owner,
          page: page + 1,
          totalPages,
          fetchedCount: totalFetched,
          estimatedTotal,
          commenterUsername: commenter.username,
          commenterFullName: commenter.fullName || undefined,
          avatarUrl: commenter.profilePicUrl || undefined,
          isVerified: commenter.isVerified,
          isPrivate: commenter.isPrivate,
          message: `Page ${page + 1}/${totalPages} — ${mediaFetched} commenters on @${owner ?? "unknown"}`,
        });
      }

      if (maxPages && requestCount >= maxPages) break;
      if (!result.hasMore || !result.nextMaxId) break;

      maxId = result.nextMaxId;
      page++;
      await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
    }

    mediaProcessed++;
    logger.ok(shortcode, `Done — ${mediaFetched} commenters (owner @${owner})`);
    await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
  }

  return { totalFetched, mediaProcessed, mediaFailed, estimatedTotal };
}
