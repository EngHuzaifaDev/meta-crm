"use server";

import { headers } from "next/headers";

import { getAuth } from "@/lib/auth";

export async function startCookieExtractionAction(cookiesJson: string, usernames: string[], maxPages?: number) {
  const auth = await getAuth();
  const sesh = await auth.api.getSession({ headers: await headers() });
  if (!sesh || sesh.user.role !== 0) return { error: "Unauthorized" };

  let cookies: any[];
  try {
    cookies = JSON.parse(cookiesJson);
    if (!Array.isArray(cookies)) throw new Error();
  } catch {
    return { error: "Invalid cookie JSON — expected an array" };
  }

  const { createRun, pushEvent } = await import("./progress-store");
  const { extractFollowersStreamFromCookies } = await import("./streaming-extractor");

  const runId = createRun();

  extractFollowersStreamFromCookies({ cookies, usernames, maxPages, runId }, (event) => pushEvent(runId, event));

  return { runId };
}

export async function pollExtractionAction(runId: string) {
  const { getRunState } = await import("./progress-store");
  const state = getRunState(runId, 50);
  if (!state) return { status: "not_found" as const, progress: [], lastEvent: null };
  return {
    status: state.status,
    progress: state.progress,
    lastEvent: state.lastEvent,
  };
}

export async function stopExtractionAction(runId: string) {
  const { markStopped } = await import("./progress-store");
  markStopped(runId);
  return { success: true };
}

export async function checkScrapedSourcesAction(usernames: string[]) {
  const { checkScrapedStatusBatch } = await import("@/lib/db/utils/instagram");
  const statuses = await checkScrapedStatusBatch(usernames);
  return statuses as Record<string, "scraped" | "private" | "invalid" | null>;
}

export async function getScrapedSourcesAction(limit = 10) {
  const { getScrapedSources, countScrapedSources } = await import("@/lib/db/utils/instagram");
  const [sources, total] = await Promise.all([getScrapedSources(limit), countScrapedSources()]);
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
