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

  const driver = await createDriver();
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

  const driver = await createDriver();
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

export async function startCookieExtractionAction(cookiesJson: string, usernames: string[], maxPages?: number) {
  const sesh = await auth.api.getSession({ headers: await headers() });
  if (!sesh || sesh.user.role !== 0) return { error: "Unauthorized" };

  let cookies: any[];
  try {
    cookies = JSON.parse(cookiesJson);
    if (!Array.isArray(cookies)) throw new Error();
  } catch {
    return { error: "Invalid cookie JSON — expected an array" };
  }

  const { createRun, pushEvent } = await import("./progress-store");
  const { extractFollowersStreamFromCookies } = await import("./streaming-extractor");

  const runId = createRun();

  extractFollowersStreamFromCookies(
    { cookies, usernames, maxPages },
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

export async function getProfileFollowersAction(profileUsername: string): Promise<string[]> {
  const { getFollowersForProfile } = await import("@/lib/db/utils/instagram");
  const records = await getFollowersForProfile(profileUsername);
  return records.map((r) => r.followerUsername);
}

// Multi-account extraction run actions

export async function createExtractionRunAction(label: string, targetUsernames: string[]) {
  const sesh = await auth.api.getSession({ headers: await headers() });
  if (!sesh || sesh.user.role !== 0) return { error: "Unauthorized" };

  const { createRun } = await import("@/lib/db/utils/extraction-runs");

  const runId = await createRun({
    adminUserId: sesh.user.id,
    label,
    accounts: [],
    targetUsernames,
    completedUsernames: [],
    currentUsernameIndex: 0,
    currentAccountIndex: 0,
    requestsSinceRotation: 0,
    currentCursor: null,
    status: "idle",
    stats: {
      totalFollowers: 0,
      totalEstimated: 0,
      invalidCount: 0,
      privateCount: 0,
      duplicateCount: 0,
      processedCount: 0,
    },
  });

  return { runId: String(runId) };
}

export async function addAccountToRunAction(runId: string, label: string, cookiesJson: string) {
  const sesh = await auth.api.getSession({ headers: await headers() });
  if (!sesh || sesh.user.role !== 0) return { error: "Unauthorized" };

  let cookies: any[];
  try {
    cookies = JSON.parse(cookiesJson);
    if (!Array.isArray(cookies)) throw new Error();
  } catch {
    return { error: "Invalid cookie JSON" };
  }

  const { parseCookies } = await import("./cookie-session");
  const session = parseCookies(cookies);
  if (!session.ds_user_id) {
    return { error: "Cookies missing ds_user_id" };
  }

  const { addAccountToRun } = await import("@/lib/db/utils/extraction-runs");

  await addAccountToRun(runId, {
    label: label || `Account ${session.ds_user_id.slice(0, 8)}`,
    cookies,
    ds_user_id: session.ds_user_id,
    errorCount: 0,
    lastUsedAt: null,
    isActive: true,
  });

  return { success: true };
}

export async function removeAccountFromRunAction(runId: string, dsUserId: string) {
  const sesh = await auth.api.getSession({ headers: await headers() });
  if (!sesh || sesh.user.role !== 0) return { error: "Unauthorized" };

  const { removeAccountFromRun } = await import("@/lib/db/utils/extraction-runs");
  await removeAccountFromRun(runId, dsUserId);
  return { success: true };
}

export async function startExtractionRunAction(runId: string) {
  const sesh = await auth.api.getSession({ headers: await headers() });
  if (!sesh || sesh.user.role !== 0) return { error: "Unauthorized" };

  const { getRun, updateRunStatus } = await import("@/lib/db/utils/extraction-runs");

  const run = await getRun(runId);
  if (!run) return { error: "Run not found" };
  if (run.accounts.length === 0) return { error: "No accounts added" };

  if (run.status === "running") return { error: "Already running" };

  await updateRunStatus(runId, "running");

  const { runExtractionSession } = await import("./streaming-extractor");
  const { createRun: createMemRun, pushEvent } = await import("./progress-store");

  const memRunId = createMemRun();

  runExtractionSession({
    runId,
    onProgress: (event) => pushEvent(memRunId, event),
  });

  return { memRunId };
}

export async function pauseExtractionRunAction(runId: string) {
  const sesh = await auth.api.getSession({ headers: await headers() });
  if (!sesh || sesh.user.role !== 0) return { error: "Unauthorized" };

  const { updateRunStatus } = await import("@/lib/db/utils/extraction-runs");
  await updateRunStatus(runId, "paused");
  return { success: true };
}

export async function stopExtractionRunAction(runId: string) {
  const sesh = await auth.api.getSession({ headers: await headers() });
  if (!sesh || sesh.user.role !== 0) return { error: "Unauthorized" };

  const { updateRunStatus } = await import("@/lib/db/utils/extraction-runs");
  await updateRunStatus(runId, "completed");
  return { success: true };
}

export async function getExtractionRunAction(runId: string) {
  const sesh = await auth.api.getSession({ headers: await headers() });
  if (!sesh || sesh.user.role !== 0) return { error: "Unauthorized" };

  const { getRun } = await import("@/lib/db/utils/extraction-runs");
  const run = await getRun(runId);
  if (!run) return null;

  return {
    _id: String(run._id),
    label: run.label,
    accounts: run.accounts.map((a) => ({
      label: a.label,
      ds_user_id: a.ds_user_id,
      isActive: a.isActive,
      errorCount: a.errorCount,
    })),
    targetUsernames: run.targetUsernames,
    completedUsernames: run.completedUsernames,
    currentUsernameIndex: run.currentUsernameIndex,
    status: run.status,
    stats: run.stats,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

export async function listExtractionRunsAction() {
  const sesh = await auth.api.getSession({ headers: await headers() });
  if (!sesh || sesh.user.role !== 0) return [];

  const { listRuns } = await import("@/lib/db/utils/extraction-runs");
  const runs = await listRuns(sesh.user.id);
  return runs.map((r) => ({
    _id: String(r._id),
    label: r.label,
    status: r.status,
    accountsCount: r.accounts.length,
    targetCount: r.targetUsernames.length,
    completedCount: r.completedUsernames.length,
    stats: r.stats,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

export async function deleteExtractionRunAction(runId: string) {
  const sesh = await auth.api.getSession({ headers: await headers() });
  if (!sesh || sesh.user.role !== 0) return { error: "Unauthorized" };

  const { deleteRun } = await import("@/lib/db/utils/extraction-runs");
  await deleteRun(runId);
  return { success: true };
}

export async function getRunFollowersCSVAction(runId: string): Promise<{ csv: string; filename: string } | { error: string }> {
  const sesh = await auth.api.getSession({ headers: await headers() });
  if (!sesh || sesh.user.role !== 0) return { error: "Unauthorized" };

  const { getRun } = await import("@/lib/db/utils/extraction-runs");
  const run = await getRun(runId);
  if (!run) return { error: "Run not found" };

  const { getFollowersForProfile } = await import("@/lib/db/utils/instagram");

  const header = "profile_username,follower_username\n";
  const rows: string[] = [];

  for (const profileUsername of run.completedUsernames) {
    const followers = await getFollowersForProfile(profileUsername);
    for (const f of followers) {
      rows.push(`${profileUsername},${f.followerUsername}`);
    }
  }

  const csv = header + rows.join("\n");
  const filename = `extraction-${run.label.replace(/\s+/g, "-")}-${new Date().toISOString().slice(0, 10)}.csv`;

  return { csv, filename };
}
