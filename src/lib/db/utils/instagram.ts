import type { Collection } from "mongodb";

import { connectDb } from "@/lib/db/mongodb";

import type { InstagramFollowerRecord, InstagramTargetProfile } from "./types";

let targetProfilesCol: Collection<InstagramTargetProfile> | null = null;
let followersCol: Collection<InstagramFollowerRecord> | null = null;

async function getTargetProfilesCol(): Promise<Collection<InstagramTargetProfile>> {
  if (!targetProfilesCol) {
    const db = await connectDb();
    targetProfilesCol = db.collection<InstagramTargetProfile>("instagramTargetProfiles");
  }
  return targetProfilesCol;
}

async function getFollowersCol(): Promise<Collection<InstagramFollowerRecord>> {
  if (!followersCol) {
    const db = await connectDb();
    followersCol = db.collection<InstagramFollowerRecord>("instagramFollowers");
    await ensureFollowersIndexes(followersCol);
  }
  return followersCol;
}

async function ensureFollowersIndexes(col: Collection<InstagramFollowerRecord>): Promise<void> {
  await col.createIndex({ sourceProfileUsername: 1, followerUsername: 1 }, { unique: true, background: true });
  await col.createIndex({ sourceProfileUsername: 1, lastSeenAt: -1 }, { background: true });
  await col.createIndex({ lastSeenAt: -1 }, { background: true });
  await col.createIndex({ sourceProfileUsername: 1 }, { background: true });
  await col.createIndex({ followerUsername: 1 }, { background: true });
}

export async function addTargetProfile(data: {
  addedByUserId: string;
  profileUsername: string;
}): Promise<InstagramTargetProfile> {
  const col = await getTargetProfilesCol();
  const now = new Date();
  const doc = {
    addedByUserId: data.addedByUserId,
    profileUsername: data.profileUsername,
    createdAt: now,
    updatedAt: now,
  };
  const result = await col.insertOne(doc as any);
  return { ...doc, _id: String(result.insertedId) } as InstagramTargetProfile;
}

export async function getTargetProfiles(): Promise<InstagramTargetProfile[]> {
  const col = await getTargetProfilesCol();
  return col.find({}).sort({ createdAt: -1 }).toArray();
}

export async function getTargetProfilesByUser(userId: string): Promise<InstagramTargetProfile[]> {
  const col = await getTargetProfilesCol();
  return col.find({ addedByUserId: userId }).sort({ createdAt: -1 }).toArray();
}

export async function upsertFollower(
  sourceProfileUsername: string,
  followerUsername: string,
  displayName?: string,
  avatarUrl?: string,
): Promise<void> {
  const col = await getFollowersCol();
  const $set: Record<string, unknown> = { lastSeenAt: new Date() };
  if (displayName !== undefined) $set.followerDisplayName = displayName;
  if (avatarUrl !== undefined) $set.followerAvatarUrl = avatarUrl;
  await col.updateOne(
    { sourceProfileUsername, followerUsername },
    { $set, $inc: { appearanceCount: 1 }, $setOnInsert: { firstSeenAt: new Date() } },
    { upsert: true },
  );
}

export async function bulkUpsertFollowers(
  sourceProfileUsername: string,
  followers: Array<{ followerUsername: string; displayName?: string; avatarUrl?: string }>,
  sourceType: "followers" | "comments" = "followers",
): Promise<{ upserted: number; matched: number }> {
  const col = await getFollowersCol();
  const now = new Date();
  const ops = followers.map((f) => ({
    updateOne: {
      filter: { sourceProfileUsername, followerUsername: f.followerUsername },
      update: {
        $set: {
          lastSeenAt: now,
          sourceType,
          ...(f.displayName !== undefined && { followerDisplayName: f.displayName }),
          ...(f.avatarUrl !== undefined && { followerAvatarUrl: f.avatarUrl }),
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

export async function getFollowersForProfile(profileUsername: string): Promise<InstagramFollowerRecord[]> {
  const col = await getFollowersCol();
  return col.find({ sourceProfileUsername: profileUsername }).sort({ appearanceCount: -1 }).toArray();
}

export async function getExistingFollowerUsernames(sourceProfileUsername: string): Promise<Set<string>> {
  const col = await getFollowersCol();
  const docs = await col.find({ sourceProfileUsername }, { projection: { followerUsername: 1 } }).toArray();
  return new Set(docs.map((d) => d.followerUsername));
}

export async function isProfileAlreadyScraped(profileUsername: string): Promise<boolean> {
  const [followersP, targetP] = await Promise.all([getFollowersCol(), getTargetProfilesCol()]);
  const [follower, flag] = await Promise.all([
    followersP.findOne({ sourceProfileUsername: profileUsername }, { projection: { _id: 1 } }),
    targetP.findOne({ profileUsername, $or: [{ isPrivate: true }, { isInvalid: true }] }, { projection: { _id: 1 } }),
  ]);
  return !!follower || !!flag;
}

export async function checkScrapedStatusBatch(
  usernames: string[],
): Promise<Record<string, "scraped" | "private" | "invalid" | null>> {
  const [followersP, targetP] = await Promise.all([getFollowersCol(), getTargetProfilesCol()]);
  const [followers, flags] = await Promise.all([
    followersP
      .aggregate([
        { $match: { sourceProfileUsername: { $in: usernames } } },
        { $group: { _id: "$sourceProfileUsername" } },
      ])
      .toArray(),
    targetP
      .find(
        { profileUsername: { $in: usernames }, $or: [{ isPrivate: true }, { isInvalid: true }] },
        { projection: { profileUsername: 1, isPrivate: 1, isInvalid: 1 } },
      )
      .toArray(),
  ]);
  const scraped = new Set(followers.map((d) => String(d._id)));
  const lookup: Record<string, "private" | "invalid"> = {};
  for (const d of flags) {
    if (d.isPrivate) lookup[d.profileUsername] = "private";
    else if (d.isInvalid) lookup[d.profileUsername] = "invalid";
  }
  const result: Record<string, "scraped" | "private" | "invalid" | null> = {};
  for (const u of usernames) {
    if (scraped.has(u)) result[u] = "scraped";
    else if (lookup[u]) result[u] = lookup[u];
    else result[u] = null;
  }
  return result;
}

export async function countScrapedSources(): Promise<number> {
  const col = await getFollowersCol();
  const docs = await col.aggregate([{ $group: { _id: "$sourceProfileUsername" } }, { $count: "total" }]).toArray();
  return docs[0]?.total ?? 0;
}

export async function markProfilePrivate(profileUsername: string): Promise<void> {
  const col = await getTargetProfilesCol();
  await col.updateOne(
    { profileUsername },
    { $set: { isPrivate: true, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
    { upsert: true },
  );
}

export async function markProfileInvalid(profileUsername: string): Promise<void> {
  const col = await getTargetProfilesCol();
  await col.updateOne(
    { profileUsername },
    { $set: { isInvalid: true, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
    { upsert: true },
  );
}

export async function getScrapedSources(
  limit = 10,
): Promise<Array<{ profileUsername: string; followerCount: number; profilePicUrl?: string; isPrivate?: boolean }>> {
  const col = await getFollowersCol();
  const pipeline = [
    { $group: { _id: "$sourceProfileUsername", followerCount: { $sum: 1 } } },
    { $sort: { followerCount: -1 } },
    { $limit: limit },
    {
      $lookup: {
        from: "instagramTargetProfiles",
        localField: "_id",
        foreignField: "profileUsername",
        as: "profile",
      },
    },
    { $unwind: { path: "$profile", preserveNullAndEmptyArrays: true } },
    {
      $project: {
        profileUsername: "$_id",
        followerCount: 1,
        profilePicUrl: { $ifNull: ["$profile.profilePicUrl", null] },
        isPrivate: { $ifNull: ["$profile.isPrivate", false] },
        isInvalid: { $ifNull: ["$profile.isInvalid", false] },
      },
    },
  ];
  return col.aggregate(pipeline).toArray() as any;
}

export async function saveSourceProfilePic(profileUsername: string, profilePicUrl: string): Promise<void> {
  const col = await getTargetProfilesCol();
  await col.updateOne(
    { profileUsername },
    { $set: { profilePicUrl, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
    { upsert: true },
  );
}

export async function updateTargetProfileScraped(
  profileUsername: string,
  followerCount: number,
  profilePicUrl?: string,
): Promise<void> {
  const col = await getTargetProfilesCol();
  const $set: Record<string, unknown> = {
    lastScrapedAt: new Date(),
    followerCount,
    updatedAt: new Date(),
  };
  if (profilePicUrl) $set.profilePicUrl = profilePicUrl;
  await col.updateOne({ profileUsername }, { $set, $setOnInsert: { createdAt: new Date() } }, { upsert: true });
}

export async function getAllFollowers(
  sourceProfile?: string,
  limit = 500,
  skip = 0,
): Promise<{ followers: InstagramFollowerRecord[]; total: number }> {
  const col = await getFollowersCol();
  const filter = sourceProfile ? { sourceProfileUsername: sourceProfile } : {};
  const [followers, total] = await Promise.all([
    col.find(filter).sort({ lastSeenAt: -1 }).skip(skip).limit(limit).toArray(),
    col.countDocuments(filter),
  ]);
  return { followers, total };
}

export async function getAllDistinctSourceProfiles(): Promise<string[]> {
  const col = await getFollowersCol();
  return col.distinct("sourceProfileUsername");
}

export async function getProfilesWithStats(): Promise<
  Array<{
    profileUsername: string;
    followerCount: number;
    lastScrapedAt: Date | null;
    isPrivate: boolean;
    isInvalid: boolean;
  }>
> {
  const followers = await getFollowersCol();
  const profiles = await getTargetProfilesCol();

  const pipeline = [
    {
      $group: {
        _id: "$sourceProfileUsername",
        followerCount: { $sum: 1 },
      },
    },
    { $sort: { followerCount: -1 } },
    {
      $lookup: {
        from: "instagramTargetProfiles",
        localField: "_id",
        foreignField: "profileUsername",
        as: "profile",
      },
    },
    { $unwind: { path: "$profile", preserveNullAndEmptyArrays: true } },
    {
      $project: {
        profileUsername: "$_id",
        followerCount: 1,
        lastScrapedAt: "$profile.lastScrapedAt",
        isPrivate: { $ifNull: ["$profile.isPrivate", false] },
        isInvalid: { $ifNull: ["$profile.isInvalid", false] },
      },
    },
  ];
  return followers.aggregate(pipeline).toArray() as any;
}

export async function deleteProfileData(profileUsername: string): Promise<{ followersDeleted: number }> {
  const followers = await getFollowersCol();
  const profiles = await getTargetProfilesCol();

  const followerResult = await followers.deleteMany({ sourceProfileUsername: profileUsername });
  await profiles.deleteMany({ profileUsername });

  return { followersDeleted: followerResult.deletedCount };
}
