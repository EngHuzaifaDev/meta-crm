import type { Collection } from "mongodb";
import { ObjectId } from "mongodb";

import type { IUser } from "@/lib/db/types";

import { connectDb } from "../mongodb";

let usersCol: Collection<IUser> | null = null;

async function getUsersCollection(): Promise<Collection<IUser>> {
  if (!usersCol) {
    const db = await connectDb();
    usersCol = db.collection<IUser>("user");
  }
  return usersCol;
}

export async function getUserById(userId: string): Promise<IUser | null> {
  const col = await getUsersCollection();
  const _id = new ObjectId(userId);
  return col.findOne({ _id });
}

export async function isEmailRegistered(email: string): Promise<boolean> {
  const col = await getUsersCollection();
  const normalized = email.toLowerCase().trim();
  const user = await col.findOne({ email: normalized }, { projection: { _id: 1 } });
  return !!user;
}

export async function updateUserFields(
  userId: string,
  fields: Partial<Pick<IUser, "name" | "industry" | "role" | "services">>,
): Promise<void> {
  const col = await getUsersCollection();
  const _id = new ObjectId(userId);
  await col.updateOne({ _id }, { $set: fields });
}

export async function getUserServices(userId: string): Promise<string[]> {
  const user = await getUserById(userId);
  return user?.services ?? [];
}

export async function setUserServices(userId: string, services: string[]): Promise<void> {
  await updateUserFields(userId, { services });
}

export async function addServiceToUser(userId: string, serviceSlug: string): Promise<void> {
  const col = await getUsersCollection();
  const _id = new ObjectId(userId);
  await col.updateOne({ _id }, { $addToSet: { services: serviceSlug } });
}

export async function removeServiceFromUser(userId: string, serviceSlug: string): Promise<void> {
  const col = await getUsersCollection();
  const _id = new ObjectId(userId);
  await col.updateOne({ _id }, { $pull: { services: serviceSlug } });
}

export async function countUsers(): Promise<number> {
  const col = await getUsersCollection();
  return col.countDocuments();
}
