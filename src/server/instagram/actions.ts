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

  const [{ mongodbInstance }, { ObjectId }] = await Promise.all([
    import("@/lib/db/mongodb"),
    import("mongodb"),
  ]);
  await mongodbInstance.collection("instagramCredentials").deleteOne({ _id: new ObjectId(id) as any });

  return { success: true };
}

export async function clearSessionAction(id: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.role !== 0) return { error: "Unauthorized" };

  await clearSession(id);
  return { success: true };
}

export async function startTestLoginAction(credentialId: string) {
  const sesh = await auth.api.getSession({ headers: await headers() });
  if (!sesh || sesh.user.role !== 0) return { success: false, error: "Unauthorized" };

  const cred = await getCredentialById(credentialId);
  if (!cred) return { success: false, error: "Credential not found" };

  const { createRun, pushEvent } = await import("./progress-store");
  const runId = createRun();

  pushEvent(runId, { type: "status", message: "Opening browser..." });

  runTestLoginInBackground(cred, credentialId, runId);

  return { runId };
}

async function runTestLoginInBackground(
  cred: any,
  credentialId: string,
  runId: string,
) {
  const { pushEvent } = await import("./progress-store");
  const { createDriver } = await import("./driver");
  const { loginToInstagram } = await import("./login");
  const { createChallenge } = await import("./challenges");
  const { default: { By, until } } = await import("selenium-webdriver");

  const driver = await createDriver(process.env.PROXY_URL || undefined);
  try {
    pushEvent(runId, { type: "status", message: "Logging in..." });

    const result = await loginToInstagram(driver, {
      username: cred.instagramUsername,
      password: cred.encryptedPassword,
      credentialId,
      existingCookies: cred.session?.cookies,
    });

    if (result.needs2FA) {
      pushEvent(runId, {
        type: "2fa_required",
        credentialId,
        message: "Verification code required",
      });

      const code = await createChallenge(credentialId);

      pushEvent(runId, { type: "status", message: "Submitting verification code..." });

      const nativeSet = `const el = arguments[0]; const val = arguments[1];
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
        if (setter) { setter.call(el, val);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true })); }`;

      const focused = await driver.executeScript("return document.activeElement");
      if (focused) {
        await driver.executeScript(nativeSet, focused, code);
        await new Promise((r) => setTimeout(r, 1000));

        await driver.executeScript(`
          const spans = document.querySelectorAll('span');
          for (const s of spans) {
            const txt = s.textContent.trim().toLowerCase();
            if (txt === 'log in' || txt === 'continue' || txt === 'confirm' || txt === 'verify' || txt === 'next') {
              let el = s;
              while (el.parentElement && el.parentElement.tagName !== 'BODY') {
                if (el.parentElement.querySelector('[data-visualcompletion="ignore"]')) {
                  el.parentElement.click();
                  return;
                }
                el = el.parentElement;
              }
            }
          }
        `);

        await driver.wait(until.elementLocated(By.css("section main")), 20000);
        pushEvent(runId, { type: "done", message: "Login successful — session saved" });
      } else {
        pushEvent(runId, { type: "error", error: "No focused element for 2FA code" });
      }
      return;
    }

    if (result.success) {
      pushEvent(runId, { type: "done", message: "Login successful — session saved" });
    } else {
      pushEvent(runId, { type: "error", error: result.error || "Login failed" });
    }
  } catch (error: any) {
    pushEvent(runId, { type: "error", error: error.message || "Unknown error" });
  } finally {
    await driver.quit();
  }
}

export async function completeLoginAction(credentialId: string, code: string) {
  const sesh = await auth.api.getSession({ headers: await headers() });
  if (!sesh || sesh.user.role !== 0) return { success: false, error: "Unauthorized" };

  const cred = await getCredentialById(credentialId);
  if (!cred) return { success: false, error: "Credential not found" };

  const { createDriver } = await import("./driver");
  const { loginToInstagram } = await import("./login");

  const driver = await createDriver(process.env.PROXY_URL || undefined);
  try {
    const result = await loginToInstagram(driver, {
      username: cred.instagramUsername,
      password: cred.encryptedPassword,
      verificationCode: code,
      credentialId,
    });

    if (result.needs2FA) {
      return { success: false, error: "2FA code was incorrect or expired" };
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

export async function pollTestLoginAction(runId: string) {
  const { getRunState } = await import("./progress-store");
  return getRunState(runId);
}

export async function stopExtractionAction(runId: string) {
  const { markStopped } = await import("./progress-store");
  markStopped(runId);
  return { success: true };
}

export async function checkScrapedSourcesAction(usernames: string[]) {
  const { checkScrapedStatusBatch } = await import("@/lib/db/utils/instagram");
  const statuses = await checkScrapedStatusBatch(usernames);
  return statuses as Record<string, "scraped" | "private" | "invalid" | null>;
}

export async function getScrapedSourcesAction() {
  const { getScrapedSources, countScrapedSources } = await import("@/lib/db/utils/instagram");
  const [sources, total] = await Promise.all([getScrapedSources(10), countScrapedSources()]);
  return { sources, hasMore: total > 10, total };
}
