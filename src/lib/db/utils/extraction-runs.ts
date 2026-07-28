import { ObjectId } from "mongodb";
import { mongodbInstance } from "@/lib/db/mongodb";
import type { CookieObject } from "@/server/instagram/cookie-session";

export interface AccountEntry {
  label: string;
  cookies: CookieObject[];
  ds_user_id: string;
  errorCount: number;
  lastUsedAt: Date | null;
  isActive: boolean;
}

export interface ExtractionRun {
  _id?: ObjectId;
  adminUserId: string;
  label: string;
  accounts: AccountEntry[];
  targetUsernames: string[];
  completedUsernames: string[];
  currentUsernameIndex: number;
  currentAccountIndex: number;
  requestsSinceRotation: number;
  currentCursor: string | null;
  status: "idle" | "running" | "paused" | "completed" | "error";
  stats: {
    totalFollowers: number;
    totalEstimated: number;
    invalidCount: number;
    privateCount: number;
    duplicateCount: number;
    processedCount: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

const col = mongodbInstance.collection<ExtractionRun>("instagramExtractionRuns");

export async function createRun(data: Omit<ExtractionRun, "_id" | "createdAt" | "updatedAt">): Promise<ObjectId> {
  const now = new Date();
  const result = await col.insertOne({ ...data, createdAt: now, updatedAt: now } as ExtractionRun);
  return result.insertedId;
}

export async function getRun(runId: string): Promise<ExtractionRun | null> {
  return col.findOne({ _id: new ObjectId(runId) });
}

export async function updateRunStatus(runId: string, status: ExtractionRun["status"]): Promise<void> {
  await col.updateOne({ _id: new ObjectId(runId) }, { $set: { status, updatedAt: new Date() } });
}

export async function addAccountToRun(runId: string, account: AccountEntry): Promise<void> {
  await col.updateOne(
    { _id: new ObjectId(runId) },
    { $push: { accounts: account }, $set: { updatedAt: new Date() } },
  );
}

export async function removeAccountFromRun(runId: string, dsUserId: string): Promise<void> {
  await col.updateOne(
    { _id: new ObjectId(runId) },
    { $pull: { accounts: { ds_user_id: dsUserId } }, $set: { updatedAt: new Date() } },
  );
}

export async function saveExtractionProgress(
  runId: string,
  progress: {
    completedUsernames?: string[];
    currentUsernameIndex?: number;
    currentAccountIndex?: number;
    requestsSinceRotation?: number;
    currentCursor?: string | null;
    stats?: Partial<ExtractionRun["stats"]>;
    accounts?: AccountEntry[];
  },
): Promise<void> {
  const update: Record<string, any> = { updatedAt: new Date() };
  if (progress.completedUsernames !== undefined) update.completedUsernames = progress.completedUsernames;
  if (progress.currentUsernameIndex !== undefined) update.currentUsernameIndex = progress.currentUsernameIndex;
  if (progress.currentAccountIndex !== undefined) update.currentAccountIndex = progress.currentAccountIndex;
  if (progress.requestsSinceRotation !== undefined) update.requestsSinceRotation = progress.requestsSinceRotation;
  if (progress.currentCursor !== undefined) update.currentCursor = progress.currentCursor;
  if (progress.stats !== undefined) {
    for (const [k, v] of Object.entries(progress.stats)) {
      if (v !== undefined) update[`stats.${k}`] = v;
    }
  }
  if (progress.accounts !== undefined) update.accounts = progress.accounts;
  await col.updateOne({ _id: new ObjectId(runId) }, { $set: update });
}

export async function resetRunAccounts(runId: string): Promise<void> {
  const run = await getRun(runId);
  if (!run) return;
  const resetAccounts = run.accounts.map((a) => ({ ...a, errorCount: 0 }));
  await saveExtractionProgress(runId, { accounts: resetAccounts, currentAccountIndex: 0, requestsSinceRotation: 0 });
}

export async function listRuns(adminUserId: string, limit = 10): Promise<ExtractionRun[]> {
  return col
    .find({ adminUserId })
    .sort({ updatedAt: -1 })
    .limit(limit)
    .toArray();
}

export async function deleteRun(runId: string): Promise<void> {
  await col.deleteOne({ _id: new ObjectId(runId) });
}
