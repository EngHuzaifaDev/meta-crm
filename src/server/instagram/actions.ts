"use server";

import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import {
  createCredential,
  getActiveCredentials,
  getCredentialById,
  saveSession,
  clearSession,
} from "@/lib/db/utils/instagram";
import type { SessionData } from "@/lib/db/utils/instagram";

export async function getCredentialsAction() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.role !== 0) return [];

  const creds = await getActiveCredentials();
  return creds.map((c) => ({
    _id: String(c._id),
    instagramUsername: c.instagramUsername,
    isActive: c.isActive,
    createdAt: c.createdAt,
    session: c.session
      ? { savedAt: c.session.savedAt, expiresAt: c.session.expiresAt, userAgent: c.session.userAgent }
      : null,
  }));
}

export async function addCredentialAction(formData: FormData) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.role !== 0) {
    return { error: "Unauthorized" };
  }

  const username = formData.get("instagramUsername") as string;
  const password = formData.get("password") as string;

  if (!username?.trim() || !password?.trim()) {
    return { error: "Username and password required" };
  }

  await createCredential({
    adminUserId: session.user.id,
    instagramUsername: username.trim(),
    encryptedPassword: password,
    isActive: true,
  });

  return { success: true };
}

export async function deleteCredentialAction(id: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.role !== 0) return { error: "Unauthorized" };

  const { mongodbInstance } = await import("@/lib/db/mongodb");
  await mongodbInstance.collection("instagramCredentials").deleteOne({ _id: id as any });

  return { success: true };
}

export async function clearSessionAction(id: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.role !== 0) return { error: "Unauthorized" };

  await clearSession(id);
  return { success: true };
}

export async function testLoginAction(credentialId: string) {
  const sesh = await auth.api.getSession({ headers: await headers() });
  if (!sesh || sesh.user.role !== 0) return { success: false, error: "Unauthorized" };

  const cred = await getCredentialById(credentialId);
  if (!cred) return { success: false, error: "Credential not found" };

  const { createDriver } = await import("./driver");
  const { loginToInstagram } = await import("./login");

  const driver = await createDriver();
  try {
    const result = await loginToInstagram(driver, {
      username: cred.instagramUsername,
      password: cred.encryptedPassword,
      credentialId,
      existingCookies: cred.session?.cookies,
    });

    if (result.needs2FA) {
      return { success: false, needs2FA: true, message: "2FA code required" };
    }

    return {
      success: result.success,
      message: result.success ? "Login successful — session saved" : result.error,
      error: result.error,
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  } finally {
    await driver.quit();
  }
}

export async function resolve2FAAction(credentialId: string, code: string) {
  const { resolveChallenge } = await import("./challenges");
  const resolved = resolveChallenge(credentialId, code);
  return { success: resolved };
}

export async function startExtractionAction(credentialId: string, usernames: string[]) {
  const sesh = await auth.api.getSession({ headers: await headers() });
  if (!sesh) return { error: "Unauthorized" };

  const cred = credentialId ? await getCredentialById(credentialId) : (await getActiveCredentials())[0];
  if (!cred) return { error: "No active credentials" };

  const { createRun, pushEvent } = await import("./progress-store");
  const { extractFollowersStream } = await import("./streaming-extractor");

  const runId = createRun();

  extractFollowersStream(
    {
      credentials: {
        username: cred.instagramUsername,
        password: cred.encryptedPassword,
      },
      credentialId: String(cred._id),
      existingCookies: cred.session?.cookies,
      usernames,
    },
    (event) => pushEvent(runId, event),
  );

  return { runId };
}

export async function pollExtractionAction(runId: string) {
  const { getRunState } = await import("./progress-store");
  const state = getRunState(runId);
  if (!state) return { status: "not_found" as const, progress: [], lastEvent: null };
  return {
    status: state.status,
    progress: state.progress,
    lastEvent: state.lastEvent,
  };
}

export async function stopExtractionAction(runId: string) {
  const { markStopped } = await import("./progress-store");
  markStopped(runId);
  return { success: true };
}
