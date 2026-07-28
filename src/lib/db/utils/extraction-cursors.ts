import type { ObjectId } from "mongodb";

import { mongodbInstance } from "@/lib/db/mongodb";

export interface ExtractionCursor {
  _id?: ObjectId;
  sessionLabel: string;
  profileUsername: string;
  endCursor: string | null;
  hasNextPage: boolean;
  pageCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const cursorsCol = mongodbInstance.collection<ExtractionCursor>("extractionCursors");

export async function getCursor(sessionLabel: string, profileUsername: string): Promise<ExtractionCursor | null> {
  return cursorsCol.findOne({ sessionLabel, profileUsername });
}

export async function upsertCursor(
  sessionLabel: string,
  profileUsername: string,
  endCursor: string | null,
  hasNextPage: boolean,
): Promise<void> {
  await cursorsCol.updateOne(
    { sessionLabel, profileUsername },
    {
      $set: { endCursor, hasNextPage, updatedAt: new Date() },
      $setOnInsert: { createdAt: new Date(), pageCount: 0 },
    },
    { upsert: true },
  );
}

export async function incrementPageCount(sessionLabel: string, profileUsername: string): Promise<void> {
  await cursorsCol.updateOne(
    { sessionLabel, profileUsername },
    {
      $inc: { pageCount: 1 },
      $set: { updatedAt: new Date() },
    },
  );
}

export async function deleteCursorsForProfile(profileUsername: string): Promise<void> {
  await cursorsCol.deleteMany({ profileUsername });
}

export async function getAllCursorsForProfile(profileUsername: string): Promise<ExtractionCursor[]> {
  return cursorsCol.find({ profileUsername }).toArray();
}
