"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { addServiceToUser, getUserServices, removeServiceFromUser } from "@/lib/db/utils/user";

// Get current user’s selected service slugs
export async function getUserServicesAction(): Promise<string[]> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) throw new Error("Not authenticated");
  return getUserServices(session.user.id);
}

// Add a service slug to the user
export async function addServiceAction(slug: string): Promise<string[]> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) throw new Error("Not authenticated");
  await addServiceToUser(session.user.id, slug);
  revalidatePath("/dashboard/services");
  return getUserServices(session.user.id);
}

// Remove a service slug from the user
export async function removeServiceAction(slug: string): Promise<string[]> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) throw new Error("Not authenticated");
  await removeServiceFromUser(session.user.id, slug);
  revalidatePath("/dashboard/services");
  return getUserServices(session.user.id);
}
