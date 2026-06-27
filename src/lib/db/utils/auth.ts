// lib/db/utils/user.ts
import { ObjectId } from "mongodb";
import { mongodbInstance } from "@/lib/db/mongodb"; // your native Db instance
import { IUser } from "@/lib/db/types";

// Reference to the "user" collection (Better Auth's default)
const users = mongodbInstance.collection<IUser>("user");

/**
 * Get a user by their string ID.
 */
export async function getUserById(userId: string): Promise<IUser | null> {
  const _id = new ObjectId(userId);
  return users.findOne({ _id });
}



/**
 * Check if an email is already registered.
 */
export async function isEmailRegistered(email: string): Promise<boolean> {
  const normalized = email.toLowerCase().trim();
  const user = await users.findOne(
    { email: normalized },
    { projection: { _id: 1 } }
  );
  return !!user;
}

/**
 * Update one or more custom fields on the user document.
 */
export async function updateUserFields(
  userId: string,
  fields: Partial<Pick<IUser, "name" | "industry" | "role" | "services">>
): Promise<void> {
  const _id = new ObjectId(userId);
  await users.updateOne({ _id }, { $set: fields });
}

/**
 * Get the user's services array (list of slugs).
 */
export async function getUserServices(userId: string): Promise<string[]> {
  const user = await getUserById(userId);
  return user?.services ?? [];
}

/**
 * Replace the entire services array.
 */
export async function setUserServices(userId: string, services: string[]): Promise<void> {
  await updateUserFields(userId, { services });
}

/**
 * Add a single service slug (no duplicates).
 */
export async function addServiceToUser(userId: string, serviceSlug: string): Promise<void> {
  const _id = new ObjectId(userId);
  await users.updateOne({ _id }, { $addToSet: { services: serviceSlug } });
}

/**
 * Remove a single service slug.
 */
export async function removeServiceFromUser(userId: string, serviceSlug: string): Promise<void> {
  const _id = new ObjectId(userId);
  await users.updateOne({ _id }, { $pull: { services: serviceSlug } });
}

/**
 * Count total users (for admin detection).
 */
export async function countUsers(): Promise<number> {
  return users.countDocuments();
}