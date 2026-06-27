// lib/db/utils/pipeline.ts
import { mongodbInstance } from "@/lib/db/mongodb";
import { IPipelineStatus } from "@/lib/db/types";
import { ObjectId } from "mongodb";

const pipelineStatus = mongodbInstance.collection<IPipelineStatus>("pipelineStatus");

export async function createPipelineStatus(leadId: string): Promise<IPipelineStatus> {
  const now = new Date();
  const doc: Omit<IPipelineStatus, "_id"> = {
    leadId,
    status: "queued",
    progressCode: "queued",
    statusReport: "Waiting in queue…",       // initial message
    createdAt: now,
    updatedAt: now,
  };
  const result = await pipelineStatus.insertOne(doc as any);
  return { ...doc, _id: result.insertedId } as IPipelineStatus;
}

export async function updatePipelineStatus(
  statusId: ObjectId,
  update: Partial<Pick<IPipelineStatus, "status" | "progressCode" | "statusReport" | "error">>
) {
  await pipelineStatus.updateOne(
    { _id: statusId },
    { $set: { ...update, updatedAt: new Date() } }
  );
}

export async function getPipelineStatusByLeadId(leadId: string) {
  return pipelineStatus.findOne({ leadId });
}