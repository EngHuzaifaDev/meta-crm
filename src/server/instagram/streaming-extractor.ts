import {
  getExistingFollowerUsernames,
  isProfileAlreadyScraped,
  markProfileInvalid,
  markProfilePrivate,
  updateTargetProfileScraped,
  upsertFollower,
} from "@/lib/db/utils/instagram";

import type { CookieObject } from "./cookie-session";
import { buildInstagramHeaders, parseCookies } from "./cookie-session";
import { extractFollowersFromCookies } from "./graphql-extractor";
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

  try {
    const session = parseCookies(options.cookies);
    if (!session.csrftoken || !session.sessionid || !session.ds_user_id) {
      await onProgress({
        type: "error",
        error: "Missing required cookies: csrftoken, sessionid, ds_user_id",
      });
      return;
    }

    const hasProxy = !!getProxyUrl();
    await onProgress({
      type: "status",
      message: `Parsed session cookies successfully${hasProxy ? ` — proxy configured (${getProxyHost() ?? "unknown"})` : ""}`,
      processedCount,
      totalCount,
    });

    const proxyCheck = await verifyProxyIP();
    if (!proxyCheck.ok) {
      await onProgress({
        type: "status",
        message: `WARNING: Proxy verification failed — ${proxyCheck.error} — continuing anyway`,
        processedCount,
        totalCount,
      });
    } else {
      await onProgress({
        type: "status",
        message: `Proxy verified — IP: ${proxyCheck.ip}${proxyCheck.region ? ` (${proxyCheck.region})` : ""}`,
        processedCount,
        totalCount,
      });
    }

    const headers = buildInstagramHeaders(session, options.cookies);

    await onProgress({
      type: "status",
      message: `Starting extraction for ${totalCount} profiles`,
      processedCount,
      totalCount,
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

      const alreadyScraped = await isProfileAlreadyScraped(targetUsername);
      if (alreadyScraped) {
        await onProgress({
          type: "skipped",
          profileUsername: targetUsername,
          message: `@${targetUsername} already scraped — skipping`,
          processedCount,
          totalCount,
        });
        continue;
      }

      await onProgress({
        type: "status",
        profileUsername: targetUsername,
        message: `[${processedCount}/${totalCount}] Fetching followers for @${targetUsername}...`,
        processedCount,
        totalCount,
      });

      let profilePicUrl = "";
      let extractedCount = 0;

      try {
        const existingFollowers = await getExistingFollowerUsernames(targetUsername);

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
              totalEstimatedFollowers,
              processedCount,
              totalCount,
            });

            if (gqlEvent.followerUsername) {
              const username = gqlEvent.followerUsername;
              if (existingFollowers.has(username)) {
                duplicateCount++;
              } else {
                existingFollowers.add(username);
                await upsertFollower(targetUsername, username, undefined, gqlEvent.avatarUrl);
                extractedCount++;
                totalFollowers++;
              }

              await onProgress({
                type: "follower",
                profileUsername: targetUsername,
                followerUsername: username,
                count: extractedCount,
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
          await onProgress({
            type: "error",
            error: "Session expired — provide fresh cookies",
            processedCount,
            totalCount,
          });
          return;
        }

        if (msg.includes("PROFILE_NOT_FOUND")) {
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
          await onProgress({
            type: "status",
            profileUsername: targetUsername,
            message: `@${targetUsername}: API error — ${msg} — skipping`,
            processedCount,
            totalCount,
          });
        }
        continue;
      }

      await updateTargetProfileScraped(targetUsername, extractedCount, profilePicUrl);

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
          processedCount,
          totalCount,
        });
        await randomDelay();
      }
    }

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
    await onProgress({
      type: "error",
      error: error.message || "Unknown error during extraction",
      processedCount,
      totalCount,
    });
  }
}
