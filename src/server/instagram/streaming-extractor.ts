import { getTask, pushTaskEvent } from "@/lib/db/utils/extraction-task";
import {
  bulkUpsertFollowers,
  markProfileInvalid,
  markProfilePrivate,
  updateTargetProfileScraped,
} from "@/lib/db/utils/instagram";

import type { CookieObject } from "./cookie-session";
import { buildInstagramHeaders, parseCookies } from "./cookie-session";
import { extractFollowersFromCookies } from "./graphql-extractor";
import { logger } from "./logger";
import { getProxyHost, getProxyUrl, verifyProxyIP } from "./proxy-helper";

const SCHEMA_REMOVED_RE = /laser\.provider|You cannot use this schema|has been deleted/i;

export interface ProgressEvent {
  type: "status" | "follower" | "invalid" | "duplicate" | "skipped" | "private" | "done" | "error" | "stopped";
  profileUsername?: string;
  message?: string;
  followerUsername?: string;
  count?: number;
  totalFollowers?: number;
  invalidCount?: number;
  privateCount?: number;
  duplicateCount?: number;
  skippedCount?: number;
  processedCount?: number;
  totalCount?: number;
  error?: string;
  page?: number;
  totalPages?: number;
  estimatedTotal?: number;
  totalEstimatedFollowers?: number;
  kind?: "known" | "unknown";
}

export type ProgressCallback = (event: ProgressEvent) => void | Promise<void>;

export interface SingleProfileOptions {
  cookies: CookieObject[];
  profileUsername: string;
  maxPages?: number;
  runId: string;
}

export async function extractSingleProfileFromCookies(options: {
  cookies: CookieObject[];
  profileUsername: string;
  maxPages?: number;
  runId: string;
}): Promise<void> {
  const { cookies, profileUsername, maxPages, runId } = options;

  try {
    const session = parseCookies(cookies);
    if (!session.csrftoken || !session.sessionid || !session.ds_user_id) {
      logger.error("Session", "Missing required cookies: csrftoken, sessionid, ds_user_id");
      await pushTaskEvent(runId, {
        type: "error",
        error: "Missing required cookies: csrftoken, sessionid, ds_user_id",
      });
      return;
    }
    logger.ok("Session", `Cookies parsed — user_id=${session.ds_user_id}`);

    const hasProxy = !!getProxyUrl();
    const proxyHost = getProxyHost() ?? "none";
    logger.info("Proxy", hasProxy ? `Configured — ${proxyHost}` : "Not configured");
    await pushTaskEvent(runId, {
      type: "status",
      message: `Parsed session cookies successfully${hasProxy ? ` — proxy configured (${proxyHost})` : ""}`,
    });

    const proxyCheck = await verifyProxyIP();
    if (!proxyCheck.ok) {
      logger.warn("Proxy", `Verification failed — ${proxyCheck.error}`);
      await pushTaskEvent(runId, {
        type: "status",
        message: `WARNING: Proxy verification failed — ${proxyCheck.error} — continuing anyway`,
      });
    } else {
      logger.ok("Proxy", `Verified — IP: ${proxyCheck.ip}${proxyCheck.region ? ` (${proxyCheck.region})` : ""}`);
      await pushTaskEvent(runId, {
        type: "status",
        message: `Proxy verified — IP: ${proxyCheck.ip}${proxyCheck.region ? ` (${proxyCheck.region})` : ""}`,
      });
    }

    const headers = buildInstagramHeaders(session, cookies);

    logger.info(profileUsername, "Starting extraction...");
    await pushTaskEvent(runId, {
      type: "status",
      profileUsername,
      message: `Starting extraction for @${profileUsername}...`,
    });

    let totalFollowers = 0;
    let duplicateCount = 0;
    let newInsertCount = 0;

    const sessionSet = new Set<string>();
    let batch: Array<{ followerUsername: string; avatarUrl?: string }> = [];
    let lastPage = 0;

    const flushBatch = async () => {
      if (batch.length === 0) return;
      const result = await bulkUpsertFollowers(profileUsername, batch);
      newInsertCount += result.upserted;
      duplicateCount += result.matched;
      totalFollowers += batch.length;
      batch = [];
    };

    const result = await extractFollowersFromCookies(
      {
        headers,
        sessionCookies: session,
        maxPages,
        signal: async () => {
          const t = await getTask(runId);
          return t?.status === "stopped";
        },
      },
      profileUsername,
      async (gqlEvent) => {
        await pushTaskEvent(runId, {
          type: "status",
          profileUsername,
          message: gqlEvent.message,
          page: gqlEvent.page,
          totalPages: gqlEvent.totalPages,
          estimatedTotal: gqlEvent.estimatedTotal,
          totalFollowers,
          duplicateCount,
        });

        if (gqlEvent.followerUsername) {
          const currentPage = gqlEvent.page;
          if (currentPage !== lastPage && batch.length > 0) {
            await flushBatch();
          }
          lastPage = currentPage;

          const username = gqlEvent.followerUsername;
          if (sessionSet.has(username)) {
            duplicateCount++;
          } else {
            sessionSet.add(username);
            batch.push({ followerUsername: username, avatarUrl: gqlEvent.avatarUrl });
          }
        }
      },
    );

    await flushBatch();
    const extractedCount = sessionSet.size;
    logger.info(profileUsername, `New inserts: ${newInsertCount}, total unique: ${extractedCount}`);

    if (result.isPrivate) {
      await markProfilePrivate(profileUsername);
      await pushTaskEvent(runId, {
        type: "private",
        profileUsername,
        message: `@${profileUsername} is private — skipping`,
        privateCount: 1,
      });
      return;
    }

    await updateTargetProfileScraped(profileUsername, extractedCount, result.profilePicUrl);

    if (extractedCount > 0) {
      logger.ok(profileUsername, `${extractedCount} followers (${newInsertCount} new, ${duplicateCount} existing)`);
    } else {
      logger.info(profileUsername, "No followers found for this profile");
    }

    logger.ok(profileUsername, `Done — ${extractedCount} followers`);
    await pushTaskEvent(runId, {
      type: "done",
      message: `Extraction complete — ${extractedCount} followers from @${profileUsername}`,
      totalFollowers: extractedCount,
      duplicateCount,
    });
  } catch (err: any) {
    const msg = err.message || "";

    if (msg === "STOPPED") {
      logger.info(profileUsername, "Extraction stopped by stop signal");
      await pushTaskEvent(runId, {
        type: "stopped",
        profileUsername,
        message: "Extraction stopped by user",
      });
      return;
    }

    if (msg.includes("SESSION_EXPIRED")) {
      logger.error(profileUsername, "Session expired — need fresh cookies");
      await pushTaskEvent(runId, {
        type: "error",
        profileUsername,
        error: "Session expired — provide fresh cookies",
      });
      throw err;
    }

    if (msg.includes("PROFILE_NOT_FOUND")) {
      logger.warn(profileUsername, "Profile not found");
      await markProfileInvalid(profileUsername);
      await pushTaskEvent(runId, {
        type: "invalid",
        profileUsername,
        message: `@${profileUsername} not found`,
        invalidCount: 1,
      });
      return;
    }

    if (SCHEMA_REMOVED_RE.test(msg)) {
      logger.warn(profileUsername, `Known IG schema issue — ${msg}`);
      await pushTaskEvent(runId, {
        type: "skipped",
        kind: "known",
        profileUsername,
        message: `@${profileUsername}: Instagram removed a profile-info schema for this account (known issue) — skipped`,
        skippedCount: 1,
      });
      return;
    }

    logger.error(profileUsername, `API error — ${msg}`);
    await pushTaskEvent(runId, {
      type: "error",
      profileUsername,
      error: msg,
    });
    throw err;
  }
}
