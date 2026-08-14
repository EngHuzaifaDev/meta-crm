import type { Collection } from "mongodb";

import { connectDb } from "@/lib/db/mongodb";

import type { HarvestLogEntry, InstagramHarvestLogRun } from "./types";

const MAX_ENTRIES_PER_RUN = 300;
const MAX_BODY_CHARS = 30000;

let logsCol: Collection<InstagramHarvestLogRun> | null = null;

async function getLogsCol(): Promise<Collection<InstagramHarvestLogRun>> {
  if (!logsCol) {
    const db = await connectDb();
    logsCol = db.collection<InstagramHarvestLogRun>("instagramHarvestLogs");
    await logsCol.createIndex({ runId: 1 }, { unique: true, background: true });
    await logsCol.createIndex({ "entries.ts": -1 }, { background: true });
  }
  return logsCol;
}

export function truncateBody(body: string): string {
  return body.length > MAX_BODY_CHARS ? `${body.slice(0, MAX_BODY_CHARS)}\n…[truncated ${body.length} chars]` : body;
}

export async function pushHarvestLog(runId: string, entry: Omit<HarvestLogEntry, "ts">): Promise<void> {
  const col = await getLogsCol();
  const record: HarvestLogEntry = {
    ...entry,
    ts: new Date(),
    body: entry.body !== undefined ? truncateBody(entry.body) : undefined,
  };
  await col.updateOne(
    { runId },
    { $push: { entries: { $each: [record], $slice: -MAX_ENTRIES_PER_RUN } }, $set: { updatedAt: new Date() } },
    { upsert: true },
  );
}

export async function getHarvestLogs(runId: string): Promise<HarvestLogEntry[]> {
  const col = await getLogsCol();
  const doc = await col.findOne({ runId });
  return doc?.entries ?? [];
}

export async function getHarvestLogsForRuns(
  runIds: string[],
  limitPerRun = 50,
): Promise<Record<string, HarvestLogEntry[]>> {
  const col = await getLogsCol();
  const docs = await col.find({ runId: { $in: runIds } }).toArray();
  const result: Record<string, HarvestLogEntry[]> = {};
  for (const doc of docs) {
    result[doc.runId] = (doc.entries ?? []).slice(-limitPerRun);
  }
  return result;
}
