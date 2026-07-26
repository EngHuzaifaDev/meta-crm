// lib/db/utils/user.ts

import { ObjectId } from "mongodb";

import type { IUser } from "@/lib/db/types";

import { mongodbInstance } from "../mongodb"; // your new native connection

const users = mongodbInstance.collection<IUser>("user");

export async function getUserById(userId: string): Promise<IUser | null> {
  const _id = new ObjectId(userId);
  return users.findOne({ _id });
}

export async function isEmailRegistered(email: string): Promise<boolean> {
  const normalized = email.toLowerCase().trim();
  const user = await users.findOne({ email: normalized }, { projection: { _id: 1 } });
  return !!user;
}

export async function updateUserFields(
  userId: string,
  fields: Partial<Pick<IUser, "name" | "industry" | "role" | "services">>,
): Promise<void> {
  const _id = new ObjectId(userId);
  await users.updateOne({ _id }, { $set: fields });
}

export async function getUserServices(userId: string): Promise<string[]> {
  const user = await getUserById(userId);
  return user?.services ?? [];
}

export async function setUserServices(userId: string, services: string[]): Promise<void> {
  await updateUserFields(userId, { services });
}

export async function addServiceToUser(userId: string, serviceSlug: string): Promise<void> {
  const _id = new ObjectId(userId);
  await users.updateOne({ _id }, { $addToSet: { services: serviceSlug } });
}

export async function removeServiceFromUser(userId: string, serviceSlug: string): Promise<void> {
  const _id = new ObjectId(userId);
  await users.updateOne({ _id }, { $pull: { services: serviceSlug } });
}

export async function countUsers(): Promise<number> {
  return users.countDocuments();
}
