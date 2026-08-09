import type { Collection } from "mongodb";

import { connectDb } from "@/lib/db/mongodb";

import type { ExtractionTask } from "./types";

let tasksCol: Collection<ExtractionTask> | null = null;

async function getTasksCol(): Promise<Collection<ExtractionTask>> {
  if (!tasksCol) {
    const db = await connectDb();
    tasksCol = db.collection<ExtractionTask>("extractionTasks");
    await tasksCol.createIndex({ status: 1, createdAt: 1 }, { background: true });
    await tasksCol.createIndex({ runId: 1 }, { unique: true, background: true });
    await tasksCol.createIndex({ userId: 1 }, { background: true });
    await tasksCol.createIndex({ batchId: 1 }, { background: true });
  }
  return tasksCol;
}

export async function createTask(opts: {
  runId: string;
  userId: string;
  cookies: string;
  profileUsername: string;
  maxPages?: number;
  batchId?: string;
}): Promise<void> {
  const col = await getTasksCol();
  const now = new Date();
  const doc: ExtractionTask = {
    runId: opts.runId,
    userId: opts.userId,
    batchId: opts.batchId,
    status: "pending",
    cookieHash: opts.runId.slice(0, 8),
    cookies: opts.cookies,
    profileUsername: opts.profileUsername,
    maxPages: opts.maxPages,
    totalFetched: 0,
    estimatedTotal: 0,
    pagesFetched: 0,
    newInserts: 0,
    events: [],
    createdAt: now,
    updatedAt: now,
  };
  await col.insertOne(doc as any);
}

export async function claimNextPendingTask(): Promise<ExtractionTask | null> {
  const col = await getTasksCol();
  const now = new Date();
  const doc = await col.findOneAndUpdate(
    { status: "pending" },
    { $set: { status: "running", startedAt: now, updatedAt: now } },
    { sort: { createdAt: 1 }, returnDocument: "after" },
  );
  return doc as ExtractionTask | null;
}

export async function pushTaskEvent(
  runId: string,
  event: ExtractionTask["events"][number],
  inc?: { newInserts?: number; totalFetched?: number; pagesFetched?: number },
): Promise<void> {
  const col = await getTasksCol();
  const update: Record<string, any> = {
    $push: { events: { $each: [event], $slice: -1000 } },
    $set: { updatedAt: new Date() },
  };
  if (inc) {
    const $inc: Record<string, number> = {};
    if (inc.newInserts) $inc.newInserts = inc.newInserts;
    if (inc.totalFetched) $inc.totalFetched = inc.totalFetched;
    if (inc.pagesFetched) $inc.pagesFetched = inc.pagesFetched;
    update.$inc = $inc;
  }
  await col.updateOne({ runId }, update);
}

export async function completeTask(runId: string): Promise<void> {
  const col = await getTasksCol();
  await col.updateOne({ runId }, { $set: { status: "done", completedAt: new Date(), updatedAt: new Date() } });
}

export async function failTask(runId: string, error: string, errorType: ExtractionTask["errorType"]): Promise<void> {
  const col = await getTasksCol();
  await col.updateOne(
    { runId },
    { $set: { status: "failed", error, errorType, completedAt: new Date(), updatedAt: new Date() } },
  );
}

export async function stopTask(runId: string): Promise<void> {
  const col = await getTasksCol();
  await col.updateOne({ runId }, { $set: { status: "stopped", updatedAt: new Date() } });
}

export async function getTask(runId: string): Promise<ExtractionTask | null> {
  const col = await getTasksCol();
  return col.findOne({ runId });
}

export async function getTasksByBatchId(batchId: string): Promise<ExtractionTask[]> {
  const col = await getTasksCol();
  return col.find({ batchId }).sort({ createdAt: 1 }).toArray();
}

export async function stopBatchTasks(batchId: string): Promise<number> {
  const col = await getTasksCol();
  const result = await col.updateMany(
    { batchId, status: { $in: ["pending", "running"] } },
    { $set: { status: "stopped", updatedAt: new Date() } },
  );
  return result.modifiedCount;
}

export async function getFailedTasks(page = 0, pageSize = 20): Promise<{ tasks: ExtractionTask[]; total: number }> {
  const col = await getTasksCol();
  const [tasks, total] = await Promise.all([
    col
      .find({ status: "failed" })
      .sort({ completedAt: -1 })
      .skip(page * pageSize)
      .limit(pageSize)
      .toArray(),
    col.countDocuments({ status: "failed" }),
  ]);
  return { tasks, total };
}

export async function retryFailedTask(runId: string): Promise<boolean> {
  const col = await getTasksCol();
  const result = await col.updateOne(
    { runId, status: "failed" },
    { $set: { status: "pending", updatedAt: new Date() }, $unset: { error: "", errorType: "" } },
  );
  return result.modifiedCount > 0;
}

export async function countRunningTasks(): Promise<number> {
  const col = await getTasksCol();
  return col.countDocuments({ status: "running" });
}
