import { getCursor, incrementPageCount, upsertCursor } from "@/lib/db/utils/extraction-cursors";
import {
  getExistingFollowerUsernames,
  isProfileAlreadyScraped,
  markProfileInvalid,
  markProfilePrivate,
  updateTargetProfileScraped,
  upsertFollower,
} from "@/lib/db/utils/instagram";

import type { CookieObject } from "./cookie-session";
import { fetchFollowersPageFromCookies, resolveProfileInfoFromCookies } from "./graphql-extractor";
import { getRunState } from "./progress-store";
import { getProxyUrl, verifyProxyIP } from "./proxy-helper";
import {
  createTrackedSessions,
  getMinCooldownMs,
  getNextSession,
  getSessionsSnapshot,
  markSessionCoolingDown,
  markSessionUsed,
  type SessionInput,
  type TrackedSession,
} from "./session-rotator";

export interface SessionExtractionOptions {
  sessions: SessionInput[];
  usernames: string[];
  runId: string;
  testMode?: boolean;
}

export interface SessionExtractionEvent {
  type: "status" | "follower" | "invalid" | "private" | "duplicate" | "done" | "error" | "stopped" | "sessionsUpdate";
  message?: string;
  error?: string;
  profileUsername?: string;
  followerUsername?: string;
  count?: number;
  totalFollowers?: number;
  totalEstimatedFollowers?: number;
  invalidCount?: number;
  privateCount?: number;
  duplicateCount?: number;
  processedCount?: number;
  totalCount?: number;
  sessions?: Array<{
    label: string;
    requestCount: number;
    maxPerHour: number;
    coolingDown: boolean;
    cooldownRemainingMs: number;
  }>;
}

export type SessionExtractionCallback = (event: SessionExtractionEvent) => void | Promise<void>;

export async function extractWithSessionRotation(
  options: SessionExtractionOptions,
  onProgress: SessionExtractionCallback,
): Promise<void> {
  const tracked = createTrackedSessions(options.sessions);
  let totalFollowers = 0;
  const totalEstimatedFollowers = 0;
  let invalidCount = 0;
  let privateCount = 0;
  let duplicateCount = 0;
  let processedCount = 0;
  const totalCount = options.usernames.length;

  const emitSessions = () =>
    onProgress({
      type: "sessionsUpdate",
      sessions: getSessionsSnapshot(tracked),
    });

  const isStopped = () => getRunState(options.runId)?.status === "stopped";

  try {
    const hasProxy = !!getProxyUrl();
    await onProgress({
      type: "status",
      message: `Loaded ${tracked.length} session(s)${hasProxy ? ", proxy configured" : ""}`,
    });
    emitSessions();

    const proxyCheck = await verifyProxyIP();
    if (!proxyCheck.ok) {
      await onProgress({
        type: "status",
        message: `WARNING: Proxy verification failed — ${proxyCheck.error} — continuing anyway`,
      });
    } else {
      await onProgress({
        type: "status",
        message: `Proxy verified — IP: ${proxyCheck.ip}`,
      });
    }

    if (isStopped()) {
      await onProgress({ type: "stopped", message: "Extraction stopped" });
      return;
    }

    for (let i = 0; i < options.usernames.length; i++) {
      if (isStopped()) {
        await emitStopped(onProgress, {
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

      if (await isProfileAlreadyScraped(targetUsername)) {
        await onProgress({
          type: "status",
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
        message: `[${processedCount}/${totalCount}] @${targetUsername} — resolving profile...`,
        processedCount,
        totalCount,
      });

      const profilePicUrl = "";
      let extractedCount = 0;
      let profileInfoResolved = false;
      const existingFollowers = await getExistingFollowerUsernames(targetUsername);

      const sessionForProfile = getNextSession(tracked);
      if (!sessionForProfile) {
        await waitForCooldown(tracked, onProgress, emitSessions);
      }

      let profileUserId = "";
      let profileIsPrivate = false;
      let cursor: string | undefined;
      let hasNextPage = true;

      const savedCursor = await getCursor(`${targetUsername}-cursor`, targetUsername);
      if (savedCursor?.endCursor) {
        cursor = savedCursor.endCursor;
        hasNextPage = savedCursor.hasNextPage;
        await onProgress({
          type: "status",
          profileUsername: targetUsername,
          message: `Resuming from saved cursor (page ${savedCursor.pageCount + 1})`,
          processedCount,
          totalCount,
        });
      }

      while (hasNextPage && !isStopped()) {
        const session = getNextSession(tracked);
        if (!session) {
          const waitMs = getMinCooldownMs(tracked);
          await onProgress({
            type: "status",
            profileUsername: targetUsername,
            message: `All sessions cooling down — waiting ${Math.ceil(waitMs / 1000)}s...`,
            processedCount,
            totalCount,
          });
          emitSessions();
          await sleep(Math.min(waitMs, 5000));
          emitSessions();
          continue;
        }

        emitSessions();

        if (!profileInfoResolved) {
          try {
            const profile = await resolveProfileInfoFromCookies(targetUsername, session.headers);
            profileUserId = profile.id;
            profileIsPrivate = profile.isPrivate;
            profileInfoResolved = true;

            if (profileIsPrivate) {
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
              break;
            }
          } catch (err: any) {
            if (err.message?.includes?.("PROFILE_NOT_FOUND")) {
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
            } else if (err.message?.startsWith?.("RATE_LIMITED")) {
              markSessionCoolingDown(session);
              await onProgress({
                type: "status",
                profileUsername: targetUsername,
                message: `Session "${session.label}" rate-limited on profile resolve — cooling down`,
                processedCount,
                totalCount,
              });
              emitSessions();
              continue;
            } else {
              await onProgress({
                type: "status",
                profileUsername: targetUsername,
                message: `@${targetUsername}: resolve error — ${err.message || err} — skipping`,
                processedCount,
                totalCount,
              });
            }
            break;
          }
          markSessionUsed(session);
          continue;
        }

        try {
          let result;
          if (options.testMode) {
            result = await fetchFollowersPageFromCookies(profileUserId, session.headers, cursor);
            markSessionUsed(session);

            for (const entry of result.usernames) {
              totalFollowers++;
              extractedCount++;
              const username = entry.username;
              if (existingFollowers.has(username)) {
                duplicateCount++;
              } else {
                existingFollowers.add(username);
                await upsertFollower(targetUsername, username, undefined, entry.profilePicUrl);
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

            const pageNum = savedCursor ? savedCursor.pageCount + 1 : 1;
            await onProgress({
              type: "status",
              profileUsername: targetUsername,
              message: `Test mode — fetched page ${pageNum} with session "${session.label}" — rotating to next session`,
              totalFollowers,
              duplicateCount,
              invalidCount,
              processedCount,
              totalCount,
            });

            await upsertCursor(
              `${targetUsername}-cursor`,
              targetUsername,
              result.endCursor ?? null,
              result.hasNextPage,
            );
            await incrementPageCount(`${targetUsername}-cursor`, targetUsername);
            hasNextPage = false;
            continue;
          }

          result = await fetchFollowersPageFromCookies(profileUserId, session.headers, cursor);
          markSessionUsed(session);

          for (const entry of result.usernames) {
            totalFollowers++;
            extractedCount++;
            const username = entry.username;
            if (existingFollowers.has(username)) {
              duplicateCount++;
            } else {
              existingFollowers.add(username);
              await upsertFollower(targetUsername, username, undefined, entry.profilePicUrl);
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

          hasNextPage = result.hasNextPage;
          if (result.endCursor) {
            cursor = result.endCursor;
          }
          await upsertCursor(`${targetUsername}-cursor`, targetUsername, result.endCursor ?? null, result.hasNextPage);
          await incrementPageCount(`${targetUsername}-cursor`, targetUsername);
          emitSessions();
        } catch (err: any) {
          const msg = err.message || "";

          if (msg === "STOPPED") {
            await emitStopped(onProgress, {
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

          if (msg.startsWith?.("RATE_LIMITED") || msg.includes("429")) {
            markSessionCoolingDown(session);
            await onProgress({
              type: "status",
              profileUsername: targetUsername,
              message: `Session "${session.label}" rate-limited — cooling down 1h, rotating`,
              processedCount,
              totalCount,
            });
            emitSessions();
            continue;
          }

          if (msg.includes("SESSION_EXPIRED")) {
            markSessionCoolingDown(session);
            await onProgress({
              type: "status",
              profileUsername: targetUsername,
              message: `Session "${session.label}" expired — marking unusable`,
              processedCount,
              totalCount,
            });
            emitSessions();
            continue;
          }

          await onProgress({
            type: "status",
            profileUsername: targetUsername,
            message: `@${targetUsername}: API error — ${msg} — skipping`,
            processedCount,
            totalCount,
          });
          break;
        }
      }

      if (profileInfoResolved && !profileIsPrivate && extractedCount > 0) {
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

async function waitForCooldown(
  sessions: TrackedSession[],
  onProgress: SessionExtractionCallback,
  emitSessions: () => void,
): Promise<void> {
  while (true) {
    const waitMs = getMinCooldownMs(sessions);
    if (waitMs <= 0) return;
    await onProgress({
      type: "status",
      message: `All sessions at limit — waiting ${Math.ceil(waitMs / 1000)}s...`,
    });
    emitSessions();
    await sleep(Math.min(waitMs, 5000));
    emitSessions();
    const next = getNextSession(sessions);
    if (next) return;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function emitStopped(
  onProgress: SessionExtractionCallback,
  counts: {
    totalFollowers: number;
    totalEstimatedFollowers: number;
    invalidCount: number;
    privateCount: number;
    duplicateCount: number;
    processedCount: number;
    totalCount: number;
  },
): Promise<void> {
  await onProgress({
    type: "stopped",
    message: "Extraction stopped by user",
    ...counts,
  });
}
