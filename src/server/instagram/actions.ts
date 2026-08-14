"use server";

import { headers } from "next/headers";

import { getAuth } from "@/lib/auth";

export async function startCookieExtractionAction(cookiesJson: string, usernames: string[], maxPages?: number) {
  const auth = await getAuth();
  const sesh = await auth.api.getSession({ headers: await headers() });
  if (!sesh) return { error: "Unauthorized" };

  let cookies: any[];
  try {
    cookies = JSON.parse(cookiesJson);
    if (!Array.isArray(cookies)) throw new Error();
  } catch {
    return { error: "Invalid cookie JSON — expected an array" };
  }

  const { randomUUID } = await import("node:crypto");
  const { createTask } = await import("@/lib/db/utils/extraction-task");
  const { startWorkerLoop } = await import("./worker-pool");

  const batchId = randomUUID();
  const runIds: string[] = [];
  const cookiesStr = JSON.stringify(cookies);

  for (const username of usernames) {
    const runId = randomUUID();
    runIds.push(runId);
    await createTask({
      runId,
      userId: sesh.user.id,
      cookies: cookiesStr,
      kind: "followers",
      profileUsername: username,
      maxPages,
      batchId,
    });
  }

  startWorkerLoop();

  return { batchId, runIds, count: runIds.length };
}

export async function startCommentsExtractionAction(
  cookiesJson: string,
  shortcodes: string[],
  sourceUsername?: string,
  maxPages?: number,
) {
  const auth = await getAuth();
  const sesh = await auth.api.getSession({ headers: await headers() });
  if (!sesh) return { error: "Unauthorized" };

  let cookies: any[];
  try {
    cookies = JSON.parse(cookiesJson);
    if (!Array.isArray(cookies)) throw new Error();
  } catch {
    return { error: "Invalid cookie JSON — expected an array" };
  }

  const { parseShortcodes } = await import("./comments-extractor");
  const parsed = parseShortcodes(shortcodes.join(" "));
  if (parsed.length === 0) return { error: "No valid Instagram post/reel shortcodes found" };

  const { randomUUID } = await import("node:crypto");
  const { createTask } = await import("@/lib/db/utils/extraction-task");
  const { startWorkerLoop } = await import("./worker-pool");

  const batchId = randomUUID();
  const runIds: string[] = [];
  const cookiesStr = JSON.stringify(cookies);

  for (const shortcode of parsed) {
    const runId = randomUUID();
    runIds.push(runId);
    await createTask({
      runId,
      userId: sesh.user.id,
      cookies: cookiesStr,
      kind: "comments",
      profileUsername: shortcode,
      mediaShortcodes: [shortcode],
      sourceUsername: sourceUsername ?? undefined,
      maxPages,
      batchId,
    });
  }

  startWorkerLoop();

  return { batchId, runIds, count: runIds.length };
}

export async function pollExtractionAction(runId: string) {
  const { getTask } = await import("@/lib/db/utils/extraction-task");
  const task = await getTask(runId);
  if (!task) return { status: "not_found" as const, progress: [], lastEvent: null };

  const events = task.events ?? [];
  return {
    status: task.status,
    progress: events,
    lastEvent: events.length > 0 ? events[events.length - 1] : null,
  };
}

export async function pollBatchExtractionAction(batchId: string) {
  const { getTasksByBatchId } = await import("@/lib/db/utils/extraction-task");
  const tasks = await getTasksByBatchId(batchId);
  if (tasks.length === 0) return { status: "not_found" as const, progress: [], lastEvent: null, tasks: [] };

  const progress = tasks.flatMap((t) => t.events ?? []).slice(-100);
  const totalCount = tasks.length;
  let totalFollowers = 0;
  let totalEstimatedFollowers = 0;
  let invalidCount = 0;
  let privateCount = 0;
  let duplicateCount = 0;
  let skippedCount = 0;
  let processedCount = 0;

  for (const t of tasks) {
    const last = t.events?.at(-1);
    totalFollowers += last?.totalFollowers ?? 0;
    totalEstimatedFollowers += last?.totalEstimatedFollowers ?? 0;
    invalidCount += last?.invalidCount ?? 0;
    privateCount += last?.privateCount ?? 0;
    duplicateCount += last?.duplicateCount ?? 0;
    skippedCount += last?.skippedCount ?? 0;
    if (t.status !== "pending" && t.status !== "running") processedCount++;
  }

  let status: string;
  if (tasks.some((t) => t.status === "pending" || t.status === "running")) status = "running";
  else if (tasks.some((t) => t.status === "failed")) status = "error";
  else if (tasks.some((t) => t.status === "stopped")) status = "stopped";
  else status = "done";

  const lastEvent = progress.length > 0 ? progress[progress.length - 1] : null;

  return {
    status,
    progress,
    lastEvent: lastEvent
      ? {
          ...lastEvent,
          totalFollowers,
          totalEstimatedFollowers,
          invalidCount,
          privateCount,
          duplicateCount,
          skippedCount,
          processedCount,
          totalCount,
        }
      : null,
    tasks: tasks.map((t) => ({
      runId: t.runId,
      profileUsername: t.profileUsername,
      status: t.status,
      batchId: t.batchId ?? null,
    })),
  };
}

export async function stopExtractionAction(runId: string) {
  const { stopTask } = await import("@/lib/db/utils/extraction-task");
  await stopTask(runId);
  return { success: true };
}

export async function stopBatchExtractionAction(batchId: string) {
  const { stopBatchTasks } = await import("@/lib/db/utils/extraction-task");
  const stopped = await stopBatchTasks(batchId);
  return { success: true, stopped };
}

export async function checkScrapedSourcesAction(usernames: string[]) {
  const { checkScrapedStatusBatch } = await import("@/lib/db/utils/instagram");
  const statuses = await checkScrapedStatusBatch(usernames);
  return statuses as Record<string, "scraped" | "private" | "invalid" | null>;
}

export async function getScrapedSourcesAction(limit = 10, sort: "fresh" | "followers" | "followers-asc" = "followers") {
  const { getScrapedSources, countScrapedSources } = await import("@/lib/db/utils/instagram");
  const [sources, total] = await Promise.all([getScrapedSources(limit, sort), countScrapedSources()]);
  return { sources, hasMore: total > limit, total };
}

export async function getProfileFollowersAction(profileUsername: string): Promise<string[]> {
  const { getFollowersForProfile } = await import("@/lib/db/utils/instagram");
  const records = await getFollowersForProfile(profileUsername);
  return records.map((r) => r.followerUsername);
}

export async function getAllFollowersAction(sourceProfile?: string, page = 0, pageSize = 100) {
  const { getAllFollowers } = await import("@/lib/db/utils/instagram");
  const result = await getAllFollowers(sourceProfile, pageSize, page * pageSize);
  return {
    followers: result.followers.map((f) => ({
      sourceProfileUsername: f.sourceProfileUsername,
      followerUsername: f.followerUsername,
      followerDisplayName: f.followerDisplayName ?? null,
      followerAvatarUrl: f.followerAvatarUrl ?? null,
      firstSeenAt: f.firstSeenAt instanceof Date ? f.firstSeenAt.toISOString() : String(f.firstSeenAt),
      lastSeenAt: f.lastSeenAt instanceof Date ? f.lastSeenAt.toISOString() : String(f.lastSeenAt),
      appearanceCount: f.appearanceCount,
    })),
    total: result.total,
  };
}

export async function exportFollowersCSVAction(sourceProfile?: string): Promise<{ total: number }> {
  const { getAllFollowers } = await import("@/lib/db/utils/instagram");
  const { total } = await getAllFollowers(sourceProfile, 1, 0);
  return { total };
}

export async function exportFollowersCSVChunkAction(
  sourceProfile?: string,
  page = 0,
  chunkSize = 50000,
): Promise<{ csv: string; page: number; isLast: boolean }> {
  const { getAllFollowers } = await import("@/lib/db/utils/instagram");
  const { followers, total } = await getAllFollowers(sourceProfile, chunkSize, page * chunkSize);
  const rows = followers.map((f) => f.followerUsername);
  const csv = page === 0 ? ["username", ...rows].join("\n") : rows.join("\n");
  return { csv, page, isLast: page * chunkSize + followers.length >= total };
}

export async function getAllDistinctSourceProfilesAction(): Promise<string[]> {
  const { getAllDistinctSourceProfiles } = await import("@/lib/db/utils/instagram");
  return getAllDistinctSourceProfiles();
}

export async function getHarvestSourcesAction(limit = 50) {
  const { getHarvestSources } = await import("@/lib/db/utils/harvested-profiles");
  const sources = await getHarvestSources(limit);
  return sources.map((s) => ({
    sourceKey: s.sourceKey,
    profileCount: s.profileCount,
    lastHarvestedAt: s.lastHarvestedAt instanceof Date ? s.lastHarvestedAt.toISOString() : String(s.lastHarvestedAt),
  }));
}

export async function getHarvestShortcodesAction(limit = 50) {
  const { getHarvestShortcodes } = await import("@/lib/db/utils/harvested-profiles");
  const shortcodes = await getHarvestShortcodes(limit);
  return shortcodes.map((s) => ({
    shortcode: s.shortcode,
    profileCount: s.profileCount,
    lastHarvestedAt: s.lastHarvestedAt instanceof Date ? s.lastHarvestedAt.toISOString() : String(s.lastHarvestedAt),
  }));
}

export async function getHarvestedProfilesAction(
  filter: { sourceKey?: string; shortcode?: string },
  page = 0,
  pageSize = 100,
) {
  const { getHarvestedProfiles } = await import("@/lib/db/utils/harvested-profiles");
  const result = await getHarvestedProfiles(filter, pageSize, page * pageSize);
  return {
    profiles: result.profiles.map((p) => ({
      sourceKey: p.sourceKey,
      shortcode: p.shortcode,
      mediaId: p.mediaId,
      username: p.username,
      fullName: p.fullName ?? null,
      avatarUrl: p.avatarUrl ?? null,
      isVerified: p.isVerified ?? false,
      isPrivate: p.isPrivate ?? false,
      firstSeenAt: p.firstSeenAt instanceof Date ? p.firstSeenAt.toISOString() : String(p.firstSeenAt),
      lastSeenAt: p.lastSeenAt instanceof Date ? p.lastSeenAt.toISOString() : String(p.lastSeenAt),
      appearanceCount: p.appearanceCount,
    })),
    total: result.total,
  };
}

export async function exportHarvestCSVAction(
  filter: { sourceKey?: string; shortcode?: string } = {},
): Promise<{ total: number }> {
  const { getHarvestedProfiles } = await import("@/lib/db/utils/harvested-profiles");
  const { total } = await getHarvestedProfiles(filter, 1, 0);
  return { total };
}

export async function exportHarvestCSVChunkAction(
  filter: { sourceKey?: string; shortcode?: string } = {},
  page = 0,
  chunkSize = 50000,
): Promise<{ csv: string; page: number; isLast: boolean }> {
  const { getHarvestedProfiles } = await import("@/lib/db/utils/harvested-profiles");
  const { profiles, total } = await getHarvestedProfiles(filter, chunkSize, page * chunkSize);
  const rows = profiles.map((p) => p.username);
  const csv = page === 0 ? ["username", ...rows].join("\n") : rows.join("\n");
  return { csv, page, isLast: page * chunkSize + profiles.length >= total };
}

export interface SerializedHarvestLogEntry {
  ts: string;
  kind: string;
  shortcode: string;
  mediaId: string | null;
  url: string | null;
  params: Record<string, unknown> | null;
  status: number | null;
  body: string | null;
  nextMaxId: string | null;
  hasMore: boolean | null;
  commentersCount: number | null;
  error: string | null;
  durationMs: number | null;
}

export async function getHarvestLogsAction(runIds: string[], limitPerRun = 50) {
  const { getHarvestLogsForRuns } = await import("@/lib/db/utils/harvest-log");
  const logs = await getHarvestLogsForRuns(runIds, limitPerRun);
  const result: Record<string, SerializedHarvestLogEntry[]> = {};
  for (const [runId, entries] of Object.entries(logs)) {
    result[runId] = entries.map((e) => ({
      ts: e.ts instanceof Date ? e.ts.toISOString() : String(e.ts),
      kind: e.kind,
      shortcode: e.shortcode,
      mediaId: e.mediaId ?? null,
      url: e.url ?? null,
      params: e.params ?? null,
      status: e.status ?? null,
      body: e.body ?? null,
      nextMaxId: e.nextMaxId ?? null,
      hasMore: e.hasMore ?? null,
      commentersCount: e.commentersCount ?? null,
      error: e.error ?? null,
      durationMs: e.durationMs ?? null,
    }));
  }
  return result;
}

export async function getProfilesWithStatsAction() {
  const { getProfilesWithStats } = await import("@/lib/db/utils/instagram");
  return getProfilesWithStats();
}

export async function deleteProfileDataAction(profileUsername: string) {
  const auth = await getAuth();
  const sesh = await auth.api.getSession({ headers: await headers() });
  if (sesh?.user.role !== 0) return { error: "Unauthorized — admin only" };

  const { deleteProfileData } = await import("@/lib/db/utils/instagram");
  return deleteProfileData(profileUsername);
}

function serializeDate(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

export async function getFailedTasksAction(page = 0, pageSize = 20) {
  const auth = await getAuth();
  const sesh = await auth.api.getSession({ headers: await headers() });
  if (sesh?.user.role !== 0) return { error: "Unauthorized — admin only" };

  const { getFailedTasks } = await import("@/lib/db/utils/extraction-task");
  const result = await getFailedTasks(page, pageSize);

  return {
    tasks: result.tasks.map((t) => {
      const { cookies: _cookies, ...safe } = { ...t };
      return {
        ...safe,
        createdAt: serializeDate(safe.createdAt),
        startedAt: safe.startedAt ? serializeDate(safe.startedAt) : undefined,
        completedAt: safe.completedAt ? serializeDate(safe.completedAt) : undefined,
        updatedAt: serializeDate(safe.updatedAt),
      };
    }),
    total: result.total,
  };
}

export async function retryFailedTaskAction(runId: string) {
  const auth = await getAuth();
  const sesh = await auth.api.getSession({ headers: await headers() });
  if (sesh?.user.role !== 0) return { error: "Unauthorized — admin only" };

  const { retryFailedTask } = await import("@/lib/db/utils/extraction-task");
  const success = await retryFailedTask(runId);
  return { success };
}

export async function getRunningTasksAction() {
  const auth = await getAuth();
  const sesh = await auth.api.getSession({ headers: await headers() });
  if (sesh?.user.role !== 0) return { error: "Unauthorized — admin only" };

  const { getRunningTasks } = await import("@/lib/db/utils/extraction-task");
  const tasks = await getRunningTasks(20);
  return {
    tasks: tasks.map((t) => ({
      runId: t.runId,
      profileUsername: t.profileUsername,
      batchId: t.batchId ?? null,
      startedAt: t.startedAt ? serializeDate(t.startedAt) : null,
    })),
  };
}
