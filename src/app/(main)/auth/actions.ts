"use server";

import { headers } from "next/headers";

import { APIError } from "better-auth/api";
import { z } from "zod";

import { getAuth } from "@/lib/auth";
import { countUsers, isEmailRegistered, updateUserFields } from "@/lib/db/utils/user";

const emailSchema = z.string().trim().toLowerCase();
const passwordSchema = z.string().min(8, "Password must be at least 8 characters");
const nameSchema = z.string().min(2, "Name must be at least 2 characters");

const signUpSchema = z
  .object({
    name: nameSchema,
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required"),
});

export interface ActionState {
  error?: string;
  success?: boolean;
}

export async function signUp(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const raw = {
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  };
  const parsed = signUpSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const { name, email, password } = parsed.data;

  if (await isEmailRegistered(email)) {
    return { error: "An account with this email already exists." };
  }

  try {
    const auth = await getAuth();
    const result = await auth.api.signUpEmail({
      body: { name, email, password },
    });
    const userId = result?.user?.id;
    if (!userId) throw new Error("User creation returned no ID");

    const totalUsers = await countUsers();
    if (totalUsers <= 1) {
      await updateUserFields(userId, { role: 0 });
    }

    return { success: true };
  } catch (error) {
    if (error instanceof APIError) {
      if (error.status === "UNPROCESSABLE_ENTITY") return { error: "User already exists." };
      if (error.status === "BAD_REQUEST") return { error: "Invalid email format." };
    }
    console.error("Sign-up error:", error);
    return { error: "Something went wrong. Please try again." };
  }
}

export async function signIn(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const raw = {
    email: formData.get("email"),
    password: formData.get("password"),
  };
  const parsed = signInSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { email, password } = parsed.data;

  try {
    const auth = await getAuth();
    await auth.api.signInEmail({ body: { email, password } });
    return { success: true };
  } catch (error) {
    if (error instanceof APIError) {
      if (error.status === "UNAUTHORIZED") return { error: "Invalid email or password." };
      if (error.status === "BAD_REQUEST") return { error: "Invalid email format." };
    }
    console.error("Sign-in error:", error);
    return { error: "Unexpected error. Please try again." };
  }
}

export async function signOutAction() {
  const auth = await getAuth();
  await auth.api.signOut({ headers: await headers() });
}

export async function checkEmailExistsAction(email: string): Promise<boolean> {
  return isEmailRegistered(email);
}

export async function deleteAccountAction(): Promise<ActionState> {
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) return { error: "Not authenticated" };

  const _userId = session.user.id;

  try {
    await auth.api.deleteUser({
      body: {
        password: "",
      },
      headers: await headers(),
    });

    return { success: true };
  } catch (error) {
    console.error("Delete account error:", error);
    return { error: "Failed to delete account." };
  }
}
