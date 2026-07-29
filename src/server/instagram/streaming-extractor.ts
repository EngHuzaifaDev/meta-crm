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
import { getRunState } from "./progress-store";
import { getProxyHost, getProxyUrl, verifyProxyIP } from "./proxy-helper";

const MIN_DELAY_MS = 2000;
const MAX_DELAY_MS = 5000;

function randomDelay(): Promise<void> {
  const ms = MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
  return new Promise((r) => setTimeout(r, ms));
}

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
  processedCount?: number;
  totalCount?: number;
  error?: string;
  page?: number;
  totalPages?: number;
  estimatedTotal?: number;
  totalEstimatedFollowers?: number;
}

export type ProgressCallback = (event: ProgressEvent) => void | Promise<void>;

export interface CookieStreamOptions {
  cookies: CookieObject[];
  usernames: string[];
  maxPages?: number;
  runId: string;
}

export async function extractFollowersStreamFromCookies(
  options: CookieStreamOptions,
  onProgress: ProgressCallback,
): Promise<void> {
  let totalFollowers = 0;
  let totalEstimatedFollowers = 0;
  let invalidCount = 0;
  let privateCount = 0;
  let duplicateCount = 0;
  let processedCount = 0;
  const totalCount = options.usernames.length;

  const sharedState = () => ({
    totalFollowers,
    totalEstimatedFollowers,
    invalidCount,
    privateCount,
    duplicateCount,
    processedCount,
    totalCount,
  });

  try {
    const session = parseCookies(options.cookies);
    if (!session.csrftoken || !session.sessionid || !session.ds_user_id) {
      logger.error("Session", "Missing required cookies: csrftoken, sessionid, ds_user_id");
      await onProgress({
        type: "error",
        error: "Missing required cookies: csrftoken, sessionid, ds_user_id",
      });
      return;
    }
    logger.ok("Session", `Cookies parsed — user_id=${session.ds_user_id}`);

    const hasProxy = !!getProxyUrl();
    const proxyHost = getProxyHost() ?? "none";
    logger.info("Proxy", hasProxy ? `Configured — ${proxyHost}` : "Not configured");
    await onProgress({
      type: "status",
      message: `Parsed session cookies successfully${hasProxy ? ` — proxy configured (${getProxyHost() ?? "unknown"})` : ""}`,
      ...sharedState(),
    });

    const proxyCheck = await verifyProxyIP();
    if (!proxyCheck.ok) {
      logger.warn("Proxy", `Verification failed — ${proxyCheck.error}`);
      await onProgress({
        type: "status",
        message: `WARNING: Proxy verification failed — ${proxyCheck.error} — continuing anyway`,
        ...sharedState(),
      });
    } else {
      logger.ok("Proxy", `Verified — IP: ${proxyCheck.ip}${proxyCheck.region ? ` (${proxyCheck.region})` : ""}`);
      await onProgress({
        type: "status",
        message: `Proxy verified — IP: ${proxyCheck.ip}${proxyCheck.region ? ` (${proxyCheck.region})` : ""}`,
        ...sharedState(),
      });
    }

    const headers = buildInstagramHeaders(session, options.cookies);

    logger.info("Extraction", `Starting — ${totalCount} profiles`);
    await onProgress({
      type: "status",
      message: `Starting extraction for ${totalCount} profiles`,
      ...sharedState(),
    });

    for (let i = 0; i < options.usernames.length; i++) {
      if (getRunState(options.runId)?.status === "stopped") {
        await onProgress({
          type: "stopped",
          message: "Extraction stopped by user",
          totalFollowers,
          totalEstimatedFollowers,
          invalidCount,
          privateCount,
          duplicateCount,
          processedCount,
          totalCount,
        });
        return;
      }

      const targetUsername = options.usernames[i];
      processedCount = i + 1;

      logger.info(targetUsername, `[${processedCount}/${totalCount}] Fetching followers...`);
      await onProgress({
        type: "status",
        profileUsername: targetUsername,
        message: `[${processedCount}/${totalCount}] Fetching followers for @${targetUsername}...`,
        ...sharedState(),
      });

      let profilePicUrl = "";
      let extractedCount = 0;
      let newInsertCount = 0;

      try {
        const sessionSet = new Set<string>();
        let batch: Array<{ followerUsername: string; avatarUrl?: string }> = [];
        let lastPage = 0;

        const flushBatch = async () => {
          if (batch.length === 0) return;
          const result = await bulkUpsertFollowers(targetUsername, batch);
          newInsertCount += result.upserted;
          duplicateCount += result.matched;
          totalFollowers += batch.length;
          batch = [];
        };

        const result = await extractFollowersFromCookies(
          {
            headers,
            sessionCookies: session,
            maxPages: options.maxPages,
            signal: () => getRunState(options.runId)?.status === "stopped",
          },
          targetUsername,
          async (gqlEvent) => {
            if (gqlEvent.page === 1 && gqlEvent.estimatedTotal > 0) {
              totalEstimatedFollowers += gqlEvent.estimatedTotal;
            }

            await onProgress({
              type: "status",
              profileUsername: targetUsername,
              message: gqlEvent.message,
              page: gqlEvent.page,
              totalPages: gqlEvent.totalPages,
              estimatedTotal: gqlEvent.estimatedTotal,
              ...sharedState(),
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

              await onProgress({
                type: "follower",
                profileUsername: targetUsername,
                followerUsername: username,
                count: sessionSet.size,
                totalFollowers,
                totalEstimatedFollowers,
                duplicateCount,
                invalidCount,
                processedCount,
                totalCount,
              });
            }
          },
        );

        await flushBatch();
        extractedCount = sessionSet.size;
        logger.info(targetUsername, `New inserts: ${newInsertCount}, total unique: ${extractedCount}`);

        if (result.isPrivate) {
          await markProfilePrivate(targetUsername);
          privateCount++;
          await onProgress({
            type: "private",
            profileUsername: targetUsername,
            message: `@${targetUsername} is private — skipping`,
            privateCount,
            processedCount,
            totalCount,
          });
          continue;
        }

        profilePicUrl = result.profilePicUrl;

        if (extractedCount > 0) {
          logger.ok(targetUsername, `${extractedCount} followers (${newInsertCount} new, ${duplicateCount} existing)`);
        } else {
          logger.info(targetUsername, "No followers found for this profile");
        }
        await onProgress({
          type: "follower",
          profileUsername: targetUsername,
          followerUsername: undefined,
          count: extractedCount,
          totalFollowers,
          duplicateCount,
          invalidCount,
          processedCount,
          totalCount,
        });
      } catch (err: any) {
        const msg = err.message || "";

        if (msg === "STOPPED") {
          await onProgress({
            type: "stopped",
            message: "Extraction stopped by user",
            totalFollowers,
            totalEstimatedFollowers,
            invalidCount,
            privateCount,
            duplicateCount,
            processedCount,
            totalCount,
          });
          return;
        }

        if (msg.includes("SESSION_EXPIRED")) {
          logger.error(targetUsername, "Session expired — need fresh cookies");
          await onProgress({
            type: "error",
            error: "Session expired — provide fresh cookies",
            processedCount,
            totalCount,
          });
          return;
        }

        if (msg.includes("PROFILE_NOT_FOUND")) {
          logger.warn(targetUsername, "Profile not found");
          await markProfileInvalid(targetUsername);
          invalidCount++;
          await onProgress({
            type: "invalid",
            profileUsername: targetUsername,
            message: `@${targetUsername} not found`,
            invalidCount,
            processedCount,
            totalCount,
          });
        } else {
          logger.error(targetUsername, `API error — ${msg}`);
          await onProgress({
            type: "status",
            profileUsername: targetUsername,
            message: `@${targetUsername}: API error — ${msg} — skipping`,
            ...sharedState(),
          });
        }
        continue;
      }

      await updateTargetProfileScraped(targetUsername, extractedCount, profilePicUrl);

      logger.ok(
        targetUsername,
        `Done — ${extractedCount} followers (${newInsertCount} new, ${duplicateCount} existing, ${invalidCount} invalid)`,
      );
      await onProgress({
        type: "status",
        profileUsername: targetUsername,
        message: `Done — extracted ${extractedCount} followers from @${targetUsername}`,
        totalFollowers,
        duplicateCount,
        invalidCount,
        processedCount,
        totalCount,
      });

      if (i < options.usernames.length - 1) {
        await onProgress({
          type: "status",
          message: "Waiting 3-5s before next profile to avoid detection...",
          ...sharedState(),
        });
        await randomDelay();
      }
    }

    logger.ok(
      "Extraction",
      `Complete — ${totalFollowers} followers, ${invalidCount} invalid, ${privateCount} private, ${duplicateCount} dupes`,
    );
    await onProgress({
      type: "done",
      message: "Extraction complete",
      totalFollowers,
      totalEstimatedFollowers,
      invalidCount,
      privateCount,
      duplicateCount,
      processedCount,
      totalCount,
    });
  } catch (error: any) {
    logger.error("Extraction", `Fatal: ${error.message || "Unknown"}`);
    await onProgress({
      type: "error",
      error: error.message || "Unknown error during extraction",
      processedCount,
      totalCount,
    });
  }
}
