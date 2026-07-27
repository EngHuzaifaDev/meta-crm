import { ObjectId } from "mongodb";

import { mongodbInstance } from "@/lib/db/mongodb";

export interface SessionData {
  cookies: Array<{ name: string; value: string; domain: string; path: string; httpOnly?: boolean; secure?: boolean; expiry?: number }>;
  userAgent?: string;
  savedAt: Date;
  expiresAt?: Date;
}

export interface InstagramCredential {
  _id?: ObjectId;
  adminUserId: string;
  instagramUsername: string;
  encryptedPassword: string;
  isActive: boolean;
  session?: SessionData;
  createdAt: Date;
  updatedAt: Date;
}

export interface InstagramTargetProfile {
  _id?: ObjectId;
  addedByUserId: string;
  profileUsername: string;
  lastScrapedAt?: Date;
  followerCount?: number;
  profilePicUrl?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface InstagramFollowerRecord {
  _id?: ObjectId;
  sourceProfileUsername: string;
  followerUsername: string;
  followerDisplayName?: string;
  followerAvatarUrl?: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  appearanceCount: number;
}

const credentialsCol = mongodbInstance.collection<InstagramCredential>("instagramCredentials");
const targetProfilesCol = mongodbInstance.collection<InstagramTargetProfile>("instagramTargetProfiles");
const followersCol = mongodbInstance.collection<InstagramFollowerRecord>("instagramFollowers");

export async function createCredential(
  data: Omit<InstagramCredential, "_id" | "createdAt" | "updatedAt">,
): Promise<InstagramCredential> {
  const now = new Date();
  const doc = { ...data, createdAt: now, updatedAt: now };
  const result = await credentialsCol.insertOne(doc as any);
  return { ...doc, _id: result.insertedId } as InstagramCredential;
}

export async function getActiveCredentials(): Promise<InstagramCredential[]> {
  return credentialsCol.find({ isActive: true }).toArray();
}

function toObjectId(id: string) {
  try { return new ObjectId(id); } catch { return id; }
}

export async function getCredentialById(id: string): Promise<InstagramCredential | null> {
  return credentialsCol.findOne({ _id: toObjectId(id) as any });
}

export async function saveSession(
  credentialId: string,
  session: SessionData,
): Promise<void> {
  await credentialsCol.updateOne(
    { _id: toObjectId(credentialId) as any },
    { $set: { session, updatedAt: new Date() } },
  );
}

export async function clearSession(credentialId: string): Promise<void> {
  await credentialsCol.updateOne(
    { _id: toObjectId(credentialId) as any },
    { $unset: { session: "" }, $set: { updatedAt: new Date() } },
  );
}

export async function addTargetProfile(data: {
  addedByUserId: string;
  profileUsername: string;
}): Promise<InstagramTargetProfile> {
  const now = new Date();
  const doc = {
    addedByUserId: data.addedByUserId,
    profileUsername: data.profileUsername,
    createdAt: now,
    updatedAt: now,
  };
  const result = await targetProfilesCol.insertOne(doc as any);
  return { ...doc, _id: result.insertedId } as InstagramTargetProfile;
}

export async function getTargetProfiles(): Promise<InstagramTargetProfile[]> {
  return targetProfilesCol.find({}).sort({ createdAt: -1 }).toArray();
}

export async function getTargetProfilesByUser(userId: string): Promise<InstagramTargetProfile[]> {
  return targetProfilesCol.find({ addedByUserId: userId }).sort({ createdAt: -1 }).toArray();
}

export async function upsertFollower(
  sourceProfileUsername: string,
  followerUsername: string,
  displayName?: string,
  avatarUrl?: string,
): Promise<void> {
  const existing = await followersCol.findOne({
    sourceProfileUsername,
    followerUsername,
  });

  if (existing) {
    await followersCol.updateOne(
      { _id: existing._id },
      {
        $set: {
          lastSeenAt: new Date(),
          followerDisplayName: displayName ?? existing.followerDisplayName,
          followerAvatarUrl: avatarUrl ?? existing.followerAvatarUrl,
        },
        $inc: { appearanceCount: 1 },
      },
    );
  } else {
    await followersCol.insertOne({
      sourceProfileUsername,
      followerUsername,
      followerDisplayName: displayName,
      followerAvatarUrl: avatarUrl,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
      appearanceCount: 1,
    } as any);
  }
}

export async function getFollowersForProfile(profileUsername: string): Promise<InstagramFollowerRecord[]> {
  return followersCol.find({ sourceProfileUsername: profileUsername }).sort({ appearanceCount: -1 }).toArray();
}

export async function getExistingFollowerUsernames(sourceProfileUsername: string): Promise<Set<string>> {
  const docs = await followersCol
    .find(
      { sourceProfileUsername },
      { projection: { followerUsername: 1 } },
    )
    .toArray()
  return new Set(docs.map((d) => d.followerUsername))
}

export async function isProfileAlreadyScraped(profileUsername: string): Promise<boolean> {
  const follower = await followersCol.findOne(
    { sourceProfileUsername: profileUsername },
    { projection: { _id: 1 } },
  )
  return !!follower
}

export async function checkScrapedStatusBatch(usernames: string[]): Promise<Record<string, boolean>> {
  const docs = await followersCol
    .aggregate([
      { $match: { sourceProfileUsername: { $in: usernames } } },
      { $group: { _id: '$sourceProfileUsername' } },
    ])
    .toArray()
  const scraped = new Set(docs.map((d) => String(d._id)))
  const result: Record<string, boolean> = {}
  for (const u of usernames) result[u] = scraped.has(u)
  return result
}

export async function countScrapedSources(): Promise<number> {
  const docs = await followersCol
    .aggregate([{ $group: { _id: '$sourceProfileUsername' } }, { $count: 'total' }])
    .toArray()
  return docs[0]?.total ?? 0
}

export async function getScrapedSources(limit = 10): Promise<
  Array<{ profileUsername: string; followerCount: number; profilePicUrl?: string }>
> {
  const pipeline = [
    { $group: { _id: '$sourceProfileUsername', followerCount: { $sum: 1 } } },
    { $sort: { followerCount: -1 } },
    { $limit: limit },
    {
      $lookup: {
        from: 'instagramTargetProfiles',
        localField: '_id',
        foreignField: 'profileUsername',
        as: 'profile',
      },
    },
    { $unwind: { path: '$profile', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        profileUsername: '$_id',
        followerCount: 1,
        profilePicUrl: { $ifNull: ['$profile.profilePicUrl', null] },
      },
    },
  ]
  return followersCol.aggregate(pipeline).toArray() as any
}

export async function saveSourceProfilePic(
  profileUsername: string,
  profilePicUrl: string,
): Promise<void> {
  await targetProfilesCol.updateOne(
    { profileUsername },
    { $set: { profilePicUrl, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
    { upsert: true },
  )
}

export async function updateTargetProfileScraped(profileUsername: string, followerCount: number, profilePicUrl?: string): Promise<void> {
  const $set: Record<string, unknown> = {
    lastScrapedAt: new Date(),
    followerCount,
    updatedAt: new Date(),
  }
  if (profilePicUrl) $set.profilePicUrl = profilePicUrl
  await targetProfilesCol.updateOne(
    { profileUsername },
    { $set, $setOnInsert: { createdAt: new Date() } },
    { upsert: true },
  );
}

export async function updateTargetProfileScraped(profileUsername: string, followerCount: number): Promise<void> {
  await targetProfilesCol.updateOne(
    { profileUsername },
    {
      $set: {
        lastScrapedAt: new Date(),
        followerCount,
        updatedAt: new Date(),
      },
    },
  );
}
