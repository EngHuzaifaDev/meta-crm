// server/actions/auth.actions.ts
"use server";

import { z } from "zod";
import { auth } from "@/lib/auth";
import { APIError } from "better-auth/api";
import { headers } from "next/headers";
import { ObjectId } from "mongodb";
import { mongodbInstance } from "@/lib/db/mongodb";
import { ILead, INode } from "@/lib/db/types";
import {
    isEmailRegistered,
    getUserById,
    updateUserFields,
    countUsers,
} from "@/lib/db/utils/user";

// ---------- Validation Schemas ----------
const emailSchema = z.string().trim().toLowerCase();
const passwordSchema = z
    .string()
    .min(8, "Password must be at least 8 characters");
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

// ---------- Action State ----------
export interface ActionState {
    error?: string;
    success?: boolean;
}

// ---------- Sign Up ----------
export async function signUp(
    prevState: ActionState,
    formData: FormData
): Promise<ActionState> {
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

    // Duplicate email check
    if (await isEmailRegistered(email)) {
        return { error: "An account with this email already exists." };
    }

    try {
        // Create the user via Better Auth
        const result = await auth.api.signUpEmail({
            body: { name, email, password },
        });
        const userId = result?.user?.id;
        if (!userId) throw new Error("User creation returned no ID");

        // First user → admin (role = 0)
        const totalUsers = await countUsers();
        if (totalUsers <= 1) {
            await updateUserFields(userId, { role: 0 });
        }

        return { success: true };
    } catch (error) {
        if (error instanceof APIError) {
            if (error.status === "UNPROCESSABLE_ENTITY")
                return { error: "User already exists." };
            if (error.status === "BAD_REQUEST")
                return { error: "Invalid email format." };
        }
        console.error("Sign-up error:", error);
        return { error: "Something went wrong. Please try again." };
    }
}

// ---------- Sign In ----------
export async function signIn(
    prevState: ActionState,
    formData: FormData
): Promise<ActionState> {
    const raw = {
        email: formData.get("email"),
        password: formData.get("password"),
    };
    const parsed = signInSchema.safeParse(raw);
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const { email, password } = parsed.data;

    try {
        await auth.api.signInEmail({ body: { email, password } });
        return { success: true };
    } catch (error) {
        if (error instanceof APIError) {
            if (error.status === "UNAUTHORIZED")
                return { error: "Invalid email or password." };
            if (error.status === "BAD_REQUEST")
                return { error: "Invalid email format." };
        }
        console.error("Sign-in error:", error);
        return { error: "Unexpected error. Please try again." };
    }
}

// ---------- Sign Out ----------
export async function signOutAction() {
    await auth.api.signOut({ headers: await headers() });
}

// ---------- Check if Email Exists ----------
export async function checkEmailExistsAction(
    email: string
): Promise<boolean> {
    return isEmailRegistered(email);
}

// ---------- Delete Account (Cascade) ----------
export async function deleteAccountAction(): Promise<ActionState> {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.id) return { error: "Not authenticated" };

    const userId = session.user.id;

    try {
        // 1. Delete all nodes belonging to user's leads
        const leads = mongodbInstance.collection<ILead>("leads");
        const nodes = mongodbInstance.collection<INode>("nodes");

        const userLeads = await leads
            .find({ userId }, { projection: { _id: 1 } })
            .toArray();
        const leadIds = userLeads.map((lead) => lead._id);

        if (leadIds.length > 0) {
            await nodes.deleteMany({ leadId: { $in: leadIds } });
        }

        // 2. Delete all leads
        await leads.deleteMany({ password: { $exists: false } });

        // 3. Delete the user via Better Auth (removes from 'user' collection & sessions)
        await auth.api.deleteUser({
            body: {
                password: "", // Assuming password is not required for deletion; adjust as needed
            },
            headers: await headers(),
        });

        return { success: true };
    } catch (error) {
        console.error("Delete account error:", error);
        return { error: "Failed to delete account." };
    }
}