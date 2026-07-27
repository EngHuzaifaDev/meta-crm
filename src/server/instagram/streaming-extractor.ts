import {
  getExistingFollowerUsernames,
  isProfileAlreadyScraped,
  markProfileInvalid,
  markProfilePrivate,
  updateTargetProfileScraped,
  upsertFollower,
} from "@/lib/db/utils/instagram";
import { ProxyManager } from "@/server/proxy/proxy-manager";

import { createChallenge } from "./challenges";
import { createDriver, extractCookies } from "./driver";
import {
  browserSleep,
  fetchFollowersPageViaDriver,
  REQUEST_DELAY_MS,
  resolveProfileInfoViaDriver,
} from "./graphql-extractor";
import { loginToInstagram } from "./login";

const CONCURRENCY = 3;
const CALLS_PER_PROXY = 15;

export interface ProgressEvent {
  type:
    | "status"
    | "follower"
    | "invalid"
    | "duplicate"
    | "skipped"
    | "private"
    | "done"
    | "error"
    | "2fa_required"
    | "proxy_rotate"
    | "reconnecting"
    | "concurrent_status";
  profileUsername?: string;
  message?: string;
  followerUsername?: string;
  count?: number;
  totalFollowers?: number;
  invalidCount?: number;
  privateCount?: number;
  duplicateCount?: number;
  processedCount?: number;
  totalCount?: number;
  error?: string;
  credentialId?: string;
  page?: number;
  totalPages?: number;
  estimatedTotal?: number;
  totalEstimatedFollowers?: number;
  proxyIndex?: number;
  totalProxies?: number;
  callsOnProxy?: number;
  rotationCount?: number;
}

export type ProgressCallback = (event: ProgressEvent) => void | Promise<void>;

export interface StreamOptions {
  credentials: {
    username: string;
    password: string;
    verificationCode?: string;
  };
  credentialId?: string;
  existingCookies?: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    httpOnly?: boolean;
    secure?: boolean;
    expiry?: number;
  }>;
  usernames: string[];
}

interface ProfileState {
  username: string;
  cursor: string | null;
  page: number;
  totalFetched: number;
  estimatedTotal: number;
  done: boolean;
  isPrivate: boolean;
  invalid: boolean;
  profilePicUrl: string;
  userId: string;
}

async function loginWithRetry(
  proxyManager: ProxyManager,
  options: StreamOptions,
  onProgress: ProgressCallback,
): Promise<import("selenium-webdriver").WebDriver> {
  while (true) {
    const proxy = proxyManager.current ?? undefined;
    const driver = await createDriver(proxy);

    try {
      const loginResult = await loginToInstagram(driver, {
        username: options.credentials.username,
        password: options.credentials.password,
        verificationCode: options.credentials.verificationCode,
        credentialId: options.credentialId,
        existingCookies: options.existingCookies,
      });

      if (loginResult.needs2FA) {
        return driver;
      }

      if (loginResult.success) {
        return driver;
      }

      await driver.quit();

      if (proxyManager.hasProxies) {
        await onProgress({
          type: "status",
          message: `Login failed on proxy ${proxyManager.proxyIndex + 1} — rotating...`,
        });
        proxyManager.rotate();
        continue;
      }

      throw new Error(`Login failed: ${loginResult.error}`);
    } catch (err: any) {
      await driver.quit();
      if (!proxyManager.hasProxies) throw err;
      await onProgress({
        type: "status",
        message: `Login error on proxy ${proxyManager.proxyIndex + 1} — rotating...`,
      });
      proxyManager.rotate();
    }
  }
}

async function handle2FA(
  driver: import("selenium-webdriver").WebDriver,
  credentialId: string,
  onProgress: ProgressCallback,
): Promise<void> {
  await onProgress({
    type: "2fa_required",
    credentialId,
    message: "Verification code required",
  });

  const code = await createChallenge(credentialId);
  await onProgress({ type: "status", message: "Submitting 2FA code..." });

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
    await driver.wait(() => driver.executeScript("return !!document.querySelector('section main')"), 20000);

    if (credentialId) {
      const { saveSession } = await import("@/lib/db/utils/instagram");
      const cookies = await extractCookies(driver);
      await saveSession(credentialId, {
        cookies,
        userAgent: "Chrome",
        savedAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });
    }
  } else {
    throw new Error("No focused element for 2FA code");
  }
}

export async function extractFollowersStream(options: StreamOptions, onProgress: ProgressCallback): Promise<void> {
  const proxyManager = new ProxyManager();

  let totalFollowers = 0;
  let totalEstimatedFollowers = 0;
  let invalidCount = 0;
  let privateCount = 0;
  let duplicateCount = 0;
  let processedCount = 0;
  const totalCount = options.usernames.length;
  let rotationCount = 0;
  let callCount = 0;

  if (proxyManager.hasProxies) {
    await onProgress({
      type: "proxy_rotate",
      proxyIndex: proxyManager.proxyIndex,
      totalProxies: proxyManager.totalProxies,
      callsOnProxy: 0,
      rotationCount: 0,
      message: `Starting with proxy ${proxyManager.proxyIndex + 1}/${proxyManager.totalProxies}`,
      processedCount,
      totalCount,
    });
  }

  const queue = [...options.usernames];
  const active: ProfileState[] = [];
  const doneUsernames = new Set<string>();

  let driver = await loginWithRetry(proxyManager, options, onProgress);
  let driverNeeds2FA = false;

  while (queue.length > 0 || active.length > 0) {
    const slotCount = CONCURRENCY - active.length;
    for (let i = 0; i < slotCount && queue.length > 0; i++) {
      const username = queue.shift()!;

      const alreadyScraped = await isProfileAlreadyScraped(username);
      if (alreadyScraped) {
        processedCount++;
        doneUsernames.add(username);
        await onProgress({
          type: "skipped",
          profileUsername: username,
          message: `@${username} already scraped — skipping`,
          processedCount,
          totalCount,
        });
        continue;
      }

      active.push({
        username,
        cursor: null,
        page: 0,
        totalFetched: 0,
        estimatedTotal: 0,
        done: false,
        isPrivate: false,
        invalid: false,
        profilePicUrl: "",
        userId: "",
      });

      await onProgress({
        type: "concurrent_status",
        message: `Profiles: ${doneUsernames.size} done, ${active.length} active, ${queue.length} queued`,
        processedCount,
        totalCount,
      });
    }

    if (active.length === 0) break;

    const profile = active[0];

    if (driverNeeds2FA && options.credentialId) {
      await handle2FA(driver, options.credentialId, onProgress);
      driverNeeds2FA = false;
    }

    if (!profile.userId) {
      try {
        await onProgress({
          type: "status",
          profileUsername: profile.username,
          message: `Resolving @${profile.username}...`,
          processedCount: processedCount + 1,
          totalCount,
        });

        const info = await resolveProfileInfoViaDriver(driver, profile.username);
        profile.userId = info.id;
        profile.isPrivate = info.isPrivate;
        profile.profilePicUrl = info.profilePicUrl;
        callCount++;

        if (info.isPrivate) {
          await markProfilePrivate(profile.username);
          privateCount++;
          profile.done = true;
          active.shift();
          processedCount++;
          doneUsernames.add(profile.username);
          await onProgress({
            type: "private",
            profileUsername: profile.username,
            message: `@${profile.username} is private — skipping`,
            privateCount,
            processedCount,
            totalCount,
          });
          continue;
        }
      } catch (err: any) {
        if (err.message?.includes("PROFILE_NOT_FOUND")) {
          await markProfileInvalid(profile.username);
          invalidCount++;
          profile.done = true;
          active.shift();
          processedCount++;
          doneUsernames.add(profile.username);
          await onProgress({
            type: "invalid",
            profileUsername: profile.username,
            message: `@${profile.username} not found`,
            invalidCount,
            processedCount,
            totalCount,
          });
          continue;
        }
        throw err;
      }
    }

    if (profile.done) {
      active.shift();
      continue;
    }

    try {
      const existingFollowers = await getExistingFollowerUsernames(profile.username);

      const result = await fetchFollowersPageViaDriver(driver, profile.userId, profile.cursor ?? undefined);
      callCount++;

      if (profile.page === 0) {
        profile.estimatedTotal = result.estimatedTotal;
        totalEstimatedFollowers += result.estimatedTotal;
      }

      profile.page++;
      profile.cursor = result.endCursor;

      const totalPages = Math.ceil(profile.estimatedTotal / 50);

      for (const entry of result.usernames) {
        profile.totalFetched++;
        if (existingFollowers.has(entry.username)) {
          duplicateCount++;
        } else {
          existingFollowers.add(entry.username);
          await upsertFollower(profile.username, entry.username, undefined, entry.profilePicUrl || undefined);
          totalFollowers++;
        }
      }

      await onProgress({
        type: "follower",
        profileUsername: profile.username,
        followerUsername: undefined,
        count: profile.totalFetched,
        totalFollowers,
        totalEstimatedFollowers,
        duplicateCount,
        invalidCount,
        processedCount: processedCount + 1,
        totalCount,
        page: profile.page,
        totalPages,
        estimatedTotal: profile.estimatedTotal,
        callsOnProxy: callCount,
        proxyIndex: proxyManager.proxyIndex,
        rotationCount,
      });

      await onProgress({
        type: "status",
        profileUsername: profile.username,
        message: `Page ${profile.page}/${totalPages} — ${profile.totalFetched} followers from @${profile.username}`,
        page: profile.page,
        totalPages,
        estimatedTotal: profile.estimatedTotal,
        totalEstimatedFollowers,
        processedCount: processedCount + 1,
        totalCount,
        callsOnProxy: callCount,
        proxyIndex: proxyManager.proxyIndex,
        rotationCount,
      });

      if (!result.hasNextPage) {
        profile.done = true;
        processedCount++;
        doneUsernames.add(profile.username);

        await updateTargetProfileScraped(profile.username, profile.totalFetched, profile.profilePicUrl);

        await onProgress({
          type: "status",
          profileUsername: profile.username,
          message: `Done — ${profile.totalFetched} followers from @${profile.username}`,
          totalFollowers,
          duplicateCount,
          invalidCount,
          processedCount,
          totalCount,
        });

        active.shift();
      } else {
        await browserSleep(driver, REQUEST_DELAY_MS);
      }
    } catch (err: any) {
      await onProgress({
        type: "status",
        profileUsername: profile.username,
        message: `@${profile.username}: page error — ${err.message?.slice(0, 100)} — will retry on next cycle`,
        processedCount,
        totalCount,
      });
    }

    if (callCount >= CALLS_PER_PROXY && proxyManager.hasProxies) {
      callCount = 0;
      rotationCount++;

      await driver.quit();

      const newProxy = proxyManager.rotate();

      await onProgress({
        type: "proxy_rotate",
        proxyIndex: proxyManager.proxyIndex,
        totalProxies: proxyManager.totalProxies,
        callsOnProxy: 0,
        rotationCount,
        message: newProxy
          ? `Rotated to proxy ${proxyManager.proxyIndex + 1}/${proxyManager.totalProxies} (rotation #${rotationCount})`
          : `No more proxies — continuing on same IP (rotation #${rotationCount})`,
        processedCount,
        totalCount,
      });

      await onProgress({
        type: "reconnecting",
        message: newProxy
          ? `Re-logging through proxy ${proxyManager.proxyIndex + 1}/${proxyManager.totalProxies}...`
          : "Re-logging...",
        processedCount,
        totalCount,
      });

      driver = await loginWithRetry(proxyManager, options, onProgress);

      await onProgress({
        type: "status",
        message: `Reconnected — resuming ${active.length} active profiles`,
        processedCount,
        totalCount,
      });
    }
  }

  await driver.quit();

  await onProgress({
    type: "done",
    message: `Extraction complete — ${rotationCount} proxy rotations`,
    totalFollowers,
    totalEstimatedFollowers,
    invalidCount,
    privateCount,
    duplicateCount,
    processedCount,
    totalCount,
    rotationCount,
  });
}
