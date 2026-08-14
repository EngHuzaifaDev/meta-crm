import { getTask, pushTaskEvent } from "@/lib/db/utils/extraction-task";
import { pushHarvestLog } from "@/lib/db/utils/harvest-log";
import { bulkUpsertHarvestedProfiles } from "@/lib/db/utils/harvested-profiles";

import { extractCommentersFromCookies } from "./comments-extractor";
import type { CookieObject } from "./cookie-session";
import { buildInstagramHeaders, parseCookies } from "./cookie-session";
import { logger } from "./logger";
import { verifyProxyIP } from "./proxy-helper";

export interface CommentsStreamOptions {
  cookies: CookieObject[];
  shortcode: string;
  sourceUsername?: string;
  maxPages?: number;
  runId: string;
}

export async function extractSingleMediaCommentsFromCookies(options: CommentsStreamOptions): Promise<void> {
  const { cookies, shortcode, sourceUsername, maxPages, runId } = options;

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

    const proxyCheck = await verifyProxyIP();
    if (!proxyCheck.ok) {
      logger.warn("Proxy", `Verification failed — ${proxyCheck.error}`);
    }

    const headers = buildInstagramHeaders(session, cookies);

    logger.info(shortcode, "Starting comments extraction...");
    await pushTaskEvent(runId, {
      type: "status",
      profileUsername: shortcode,
      message: `Starting comments extraction for ${shortcode}...`,
    });

    const totalFetched = 0;
    let newInsertCount = 0;
    let duplicateCount = 0;
    let mediaId = "";
    let owner: string | undefined;
    const sessionSet = new Set<string>();
    let batch: Array<{
      username: string;
      fullName?: string;
      avatarUrl?: string;
      isVerified?: boolean;
      isPrivate?: boolean;
    }> = [];

    const flushBatch = async () => {
      if (batch.length === 0) return;
      const result = await bulkUpsertHarvestedProfiles(owner ?? `media_${shortcode}`, shortcode, mediaId, batch);
      newInsertCount += result.upserted;
      duplicateCount += result.matched;
      batch = [];
    };

    const result = await extractCommentersFromCookies(
      {
        headers,
        shortcodes: [shortcode],
        sourceUsername,
        maxPages,
        signal: async () => {
          const t = await getTask(runId);
          return t?.status === "stopped";
        },
        log: async (entry) => {
          await pushHarvestLog(runId, { ...entry, shortcode: entry.shortcode ?? shortcode });
        },
      },
      async (event) => {
        owner = event.mediaOwner;
        mediaId = event.mediaId;
        await pushTaskEvent(runId, {
          type: "status",
          profileUsername: shortcode,
          message: event.message,
          page: event.page,
          totalPages: event.totalPages,
          estimatedTotal: event.estimatedTotal,
          totalFollowers: totalFetched,
          duplicateCount,
        });

        if (event.commenterUsername) {
          const username = event.commenterUsername;
          if (sessionSet.has(username)) {
            duplicateCount++;
          } else {
            sessionSet.add(username);
            batch.push({
              username,
              fullName: event.commenterFullName,
              avatarUrl: event.avatarUrl,
              isVerified: event.isVerified,
              isPrivate: event.isPrivate,
            });
            if (batch.length >= 50) await flushBatch();
          }
        }
      },
    );

    await flushBatch();
    const extractedCount = sessionSet.size;
    logger.info(shortcode, `New inserts: ${newInsertCount}, total unique: ${extractedCount}`);

    if (result.mediaFailed > 0) {
      logger.warn(shortcode, `${result.mediaFailed} media items failed`);
    }

    logger.ok(shortcode, `Done — ${extractedCount} harvested profiles (${newInsertCount} new)`);
    await pushTaskEvent(runId, {
      type: "done",
      profileUsername: shortcode,
      message: `Comments extraction complete — ${extractedCount} profiles harvested from ${shortcode}`,
      totalFollowers: extractedCount,
      duplicateCount,
    });
  } catch (err: any) {
    const msg = err.message || "";

    if (msg === "STOPPED") {
      logger.info(shortcode, "Extraction stopped by stop signal");
      await pushTaskEvent(runId, {
        type: "stopped",
        profileUsername: shortcode,
        message: "Extraction stopped by user",
      });
      return;
    }

    if (msg.includes("SESSION_EXPIRED")) {
      logger.error(shortcode, "Session expired — need fresh cookies");
      await pushTaskEvent(runId, {
        type: "error",
        profileUsername: shortcode,
        error: "Session expired — provide fresh cookies",
      });
      throw err;
    }

    await pushHarvestLog(runId, {
      kind: "error",
      shortcode,
      error: msg,
    });
    logger.error(shortcode, `API error — ${msg}`);
    await pushTaskEvent(runId, {
      type: "error",
      profileUsername: shortcode,
      error: msg,
    });
    throw err;
  }
}
