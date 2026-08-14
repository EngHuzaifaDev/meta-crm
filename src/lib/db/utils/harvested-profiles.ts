import type { Collection } from "mongodb";

import { connectDb } from "@/lib/db/mongodb";

import type { InstagramHarvestedProfile } from "./types";

let harvestedCol: Collection<InstagramHarvestedProfile> | null = null;

async function getHarvestedCol(): Promise<Collection<InstagramHarvestedProfile>> {
  if (!harvestedCol) {
    const db = await connectDb();
    harvestedCol = db.collection<InstagramHarvestedProfile>("instagramHarvestedProfiles");
    await harvestedCol.createIndex({ shortcode: 1, username: 1 }, { unique: true, background: true });
    await harvestedCol.createIndex({ sourceKey: 1, lastSeenAt: -1 }, { background: true });
    await harvestedCol.createIndex({ shortcode: 1 }, { background: true });
    await harvestedCol.createIndex({ sourceKey: 1 }, { background: true });
    await harvestedCol.createIndex({ username: 1 }, { background: true });
    await harvestedCol.createIndex({ lastSeenAt: -1 }, { background: true });
  }
  return harvestedCol;
}

export interface HarvestedProfileInput {
  username: string;
  fullName?: string;
  avatarUrl?: string;
  isVerified?: boolean;
  isPrivate?: boolean;
}

export async function bulkUpsertHarvestedProfiles(
  sourceKey: string,
  shortcode: string,
  mediaId: string,
  profiles: HarvestedProfileInput[],
): Promise<{ upserted: number; matched: number }> {
  if (profiles.length === 0) return { upserted: 0, matched: 0 };
  const col = await getHarvestedCol();
  const now = new Date();
  const ops = profiles.map((p) => ({
    updateOne: {
      filter: { shortcode, username: p.username },
      update: {
        $set: {
          sourceKey,
          mediaId,
          lastSeenAt: now,
          ...(p.fullName !== undefined && { fullName: p.fullName }),
          ...(p.avatarUrl !== undefined && { avatarUrl: p.avatarUrl }),
          ...(p.isVerified !== undefined && { isVerified: p.isVerified }),
          ...(p.isPrivate !== undefined && { isPrivate: p.isPrivate }),
        },
        $inc: { appearanceCount: 1 },
        $setOnInsert: { firstSeenAt: now },
      },
      upsert: true,
    },
  }));
  const result = await col.bulkWrite(ops, { ordered: false });
  return { upserted: result.upsertedCount, matched: result.matchedCount };
}

export async function getHarvestedProfiles(
  filter: { sourceKey?: string; shortcode?: string } = {},
  limit = 100,
  skip = 0,
): Promise<{ profiles: InstagramHarvestedProfile[]; total: number }> {
  const col = await getHarvestedCol();
  const query: Record<string, string> = {};
  if (filter.sourceKey) query.sourceKey = filter.sourceKey;
  if (filter.shortcode) query.shortcode = filter.shortcode;
  const [profiles, total] = await Promise.all([
    col.find(query).sort({ lastSeenAt: -1 }).skip(skip).limit(limit).toArray(),
    col.countDocuments(query),
  ]);
  return { profiles, total };
}

export async function countHarvestedProfiles(): Promise<number> {
  const col = await getHarvestedCol();
  return col.countDocuments();
}

export async function getHarvestSources(
  limit = 20,
): Promise<Array<{ sourceKey: string; profileCount: number; lastHarvestedAt: Date | null }>> {
  const col = await getHarvestedCol();
  const pipeline = [
    {
      $group: {
        _id: "$sourceKey",
        profileCount: { $sum: 1 },
        lastHarvestedAt: { $max: "$lastSeenAt" },
      },
    },
    { $sort: { profileCount: -1 } },
    { $limit: limit },
    { $project: { sourceKey: "$_id", profileCount: 1, lastHarvestedAt: 1 } },
  ];
  return col.aggregate(pipeline).toArray() as any;
}

export async function getHarvestShortcodes(
  limit = 50,
): Promise<Array<{ shortcode: string; profileCount: number; lastHarvestedAt: Date | null }>> {
  const col = await getHarvestedCol();
  const pipeline = [
    {
      $group: {
        _id: "$shortcode",
        profileCount: { $sum: 1 },
        lastHarvestedAt: { $max: "$lastSeenAt" },
      },
    },
    { $sort: { lastHarvestedAt: -1 } },
    { $limit: limit },
    { $project: { shortcode: "$_id", profileCount: 1, lastHarvestedAt: 1 } },
  ];
  return col.aggregate(pipeline).toArray() as any;
}

export async function deleteHarvestedProfiles(shortcode: string): Promise<number> {
  const col = await getHarvestedCol();
  const result = await col.deleteMany({ shortcode });
  return result.deletedCount;
}

export async function getHarvestedDuplicateUsernames(): Promise<string[]> {
  const col = await getHarvestedCol();
  const harvested = await col.distinct("username");
  if (harvested.length === 0) return [];

  const db = await connectDb();
  const followersCol = db.collection("instagramFollowers");
  const followerUsernames = new Set<string>(await followersCol.distinct("followerUsername"));

  return harvested.filter((u) => followerUsernames.has(u)).sort();
}

export async function deleteHarvestedByUsernames(usernames: string[]): Promise<number> {
  if (usernames.length === 0) return 0;
  const col = await getHarvestedCol();
  const result = await col.deleteMany({ username: { $in: usernames } });
  return result.deletedCount;
}

const EXCLUDE_FOLLOWERS_LOOKUP = {
  $lookup: {
    from: "instagramFollowers",
    localField: "username",
    foreignField: "followerUsername",
    as: "existing",
  },
} as const;

export async function countHarvestedExcludingFollowers(): Promise<number> {
  const col = await getHarvestedCol();
  const result = await col
    .aggregate([EXCLUDE_FOLLOWERS_LOOKUP as any, { $match: { existing: { $size: 0 } } }, { $count: "n" }])
    .toArray();
  return (result[0]?.n as number | undefined) ?? 0;
}

export async function getHarvestedExcludingFollowersPage(skip: number, limit: number): Promise<string[]> {
  const col = await getHarvestedCol();
  const docs = await col
    .aggregate([
      EXCLUDE_FOLLOWERS_LOOKUP as any,
      { $match: { existing: { $size: 0 } } },
      { $sort: { _id: 1 } },
      { $skip: skip },
      { $limit: limit },
      { $project: { _id: 0, username: 1 } },
    ])
    .toArray();
  return docs.map((d) => d.username as string);
}
