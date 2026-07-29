import { proxyFetch } from "./proxy-helper";
import { logger } from "./logger";

const QUERY_HASH = "37479f2b8209594dde7facb0d904896a";
const PAGE_SIZE = 50;
const REQUEST_DELAY_MS = 500;
const MAX_REQUESTS_PER_SESSION = Infinity;

export interface SessionCookies {
  csrftoken: string;
  sessionid: string;
  ds_user_id: string;
  mid: string;
  ig_did?: string;
  rur?: string;
}

export interface ProfileInfo {
  id: string;
  isPrivate: boolean;
  profilePicUrl: string;
}

export interface GraphQLPageResult {
  usernames: Array<{ username: string; fullName: string; profilePicUrl: string; isVerified: boolean; id: string }>;
  endCursor: string | null;
  hasNextPage: boolean;
  estimatedTotal: number;
}

async function parseGraphQLResponse(data: any): Promise<GraphQLPageResult> {
  const edge = data?.data?.user?.edge_followed_by;
  if (!edge) {
    const snippet = JSON.stringify(data).slice(0, 500);
    throw new Error(`Unexpected GraphQL response — ${snippet}`);
  }
  return {
    usernames: (edge.edges || []).map((e: any) => ({
      username: e.node.username,
      fullName: e.node.full_name || "",
      profilePicUrl: e.node.profile_pic_url || "",
      isVerified: !!e.node.is_verified,
      id: String(e.node.id),
    })),
    endCursor: edge.page_info?.end_cursor || null,
    hasNextPage: !!edge.page_info?.has_next_page,
    estimatedTotal: edge.count ?? 0,
  };
}

export async function resolveProfileInfoFromCookies(
  username: string,
  headers: Record<string, string>,
): Promise<ProfileInfo> {
  logger.info(username, "Resolving profile info...")
  const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;
  const response = await proxyFetch(url, { method: "GET", headers });
  if (response.status === 404) throw new Error("PROFILE_NOT_FOUND");
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Instagram API error (${response.status}): ${body.slice(0, 200)}`);
  }
  const body = await response.text();
  let parsed: any;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error(`Profile info: non-JSON response (${response.status}): ${body.slice(0, 300)}`);
  }
  const user = parsed?.data?.user;
  if (!user) {
    throw new Error(`Profile info: unexpected structure: ${body.slice(0, 300)}`);
  }
  return {
    id: String(user.id),
    isPrivate: !!user.is_private,
    profilePicUrl: user.profile_pic_url || "",
  };
}

export async function fetchFollowersPageFromCookies(
  userId: string,
  headers: Record<string, string>,
  cursor?: string,
): Promise<GraphQLPageResult> {
  const vars: Record<string, any> = { id: userId, first: PAGE_SIZE };
  if (cursor) vars.after = cursor;

  logger.debug("GraphQL", `Page ${cursor ? "(cursor)" : "1"} — id=${userId.slice(0, 8)}...`)
  const url = `https://www.instagram.com/graphql/query/?query_hash=${QUERY_HASH}&variables=${encodeURIComponent(JSON.stringify(vars))}`;
  const response = await proxyFetch(url, { method: "GET", headers, redirect: "manual" });

  if (response.status === 302 || response.status === 303) {
    const loc = response.headers.get("location") || "";
    if (loc.includes("login") || loc.includes("accounts")) {
      throw new Error("SESSION_EXPIRED");
    }
  }

  if (response.status === 429 || response.status === 400) {
    const body = await response.text();
    throw new Error(`RATE_LIMITED: Instagram returned ${response.status} — ${body.slice(0, 200)}`);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Instagram API error (${response.status}): ${body.slice(0, 200)}`);
  }

  const text = await response.text();
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Instagram API returned non-JSON (${response.status}): ${text.slice(0, 300)}`);
  }
  return parseGraphQLResponse(parsed);
}

export interface GraphQLProgressEvent {
  profileUsername: string;
  page: number;
  totalPages: number;
  fetchedCount: number;
  estimatedTotal: number;
  followerUsername?: string;
  avatarUrl?: string;
  message: string;
}

export type GraphQLProgressCallback = (event: GraphQLProgressEvent) => void | Promise<void>;

export interface GraphQLExtractionResult {
  avatarUrls: Map<string, string>;
  totalFetched: number;
  estimatedTotal: number;
  pagesFetched: number;
  isPrivate: boolean;
  profilePicUrl: string;
}

export interface CookieBasedOptions {
  headers: Record<string, string>;
  sessionCookies: SessionCookies;
  maxPages?: number;
  signal?: () => boolean;
}

export async function extractFollowersFromCookies(
  options: CookieBasedOptions,
  targetUsername: string,
  onProgress: GraphQLProgressCallback,
): Promise<GraphQLExtractionResult> {
  const { headers, maxPages } = options;

  const profile = await resolveProfileInfoFromCookies(targetUsername, headers);

  if (profile.isPrivate) {
    return {
      profilePicUrl: profile.profilePicUrl,
      isPrivate: true,
      avatarUrls: new Map(),
      totalFetched: 0,
      estimatedTotal: 0,
      pagesFetched: 0,
    };
  }

  const userId = profile.id;

  let cursor: string | undefined;
  let page = 0;
  let totalFetched = 0;
  let estimatedTotal = 0;
  let requestCount = 0;
  const avatarUrls = new Map<string, string>();

  while (requestCount < MAX_REQUESTS_PER_SESSION) {
    if (options.signal?.()) throw new Error("STOPPED");

    let result: GraphQLPageResult;

    try {
      result = await fetchFollowersPageFromCookies(userId, headers, cursor);
    } catch (err: any) {
      if (err.message?.startsWith?.("RATE_LIMITED")) {
        const wait = Math.min(60000 * 2 ** requestCount, 300000);
        await new Promise((r) => setTimeout(r, wait));
        requestCount++;
        continue;
      }
      throw err;
    }

    requestCount++;

    if (page === 0) {
      estimatedTotal = result.estimatedTotal;
    }

    const totalPages = Math.ceil(estimatedTotal / PAGE_SIZE);

    for (const entry of result.usernames) {
      totalFetched++;
      if (entry.profilePicUrl) {
        avatarUrls.set(entry.username, entry.profilePicUrl);
      }
      await onProgress({
        profileUsername: targetUsername,
        page: page + 1,
        totalPages,
        fetchedCount: totalFetched,
        estimatedTotal,
        followerUsername: entry.username,
        avatarUrl: entry.profilePicUrl || undefined,
        message: `Page ${page + 1}/${totalPages} — ${totalFetched} followers fetched`,
      });
    }

    if (maxPages && requestCount >= maxPages) break;
    if (!result.hasNextPage) break;

    cursor = result.endCursor ?? undefined;
    page++;
    estimatedTotal = result.estimatedTotal;
    await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
  }

  return {
    profilePicUrl: profile.profilePicUrl,
    isPrivate: false,
    avatarUrls,
    totalFetched,
    estimatedTotal,
    pagesFetched: page + 1,
  };
}
