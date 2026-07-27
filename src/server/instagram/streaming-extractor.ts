import { createDriver } from "./driver";
import { loginToInstagram } from "./login";
import { ScrapingEngine } from "./scraping-engine";
import type { VariableContext } from "./types";
import { upsertFollower, updateTargetProfileScraped, getExistingFollowerUsernames, isProfileAlreadyScraped, markProfilePrivate } from "@/lib/db/utils/instagram";
import { createChallenge } from "./challenges";
import path from "node:path";

const ACTIONS_DIR = path.resolve(process.cwd(), "src/server/instagram/actions");
const NAVIGATE_YAML = path.join(ACTIONS_DIR, "navigate-profile.yaml");
const FOLLOWERS_YAML = path.join(ACTIONS_DIR, "followers.yaml");
const REELS_YAML = path.join(ACTIONS_DIR, "reels.yaml");

const REEL_SCROLL_INTERVAL = 5;

export interface ProgressEvent {
  type: "status" | "follower" | "invalid" | "duplicate" | "skipped" | "private" | "done" | "error" | "2fa_required";
  profileUsername?: string;
  message?: string;
  followerUsername?: string;
  count?: number;
  totalFollowers?: number;
  invalidCount?: number;
  duplicateCount?: number;
  processedCount?: number;
  totalCount?: number;
  error?: string;
  credentialId?: string;
}

export type ProgressCallback = (event: ProgressEvent) => void | Promise<void>;

export interface StreamOptions {
  credentials: {
    username: string;
    password: string;
    verificationCode?: string;
  };
  credentialId?: string;
  existingCookies?: Array<{ name: string; value: string; domain: string; path: string; httpOnly?: boolean; secure?: boolean; expiry?: number }>;
  usernames: string[];
}

export async function extractFollowersStream(
  options: StreamOptions,
  onProgress: ProgressCallback,
): Promise<void> {
  const driver = await createDriver();

  let totalFollowers = 0;
  let invalidCount = 0;
  let duplicateCount = 0;
  let processedCount = 0;
  const totalCount = options.usernames.length;

  try {
    await onProgress({
      type: "status",
      message: "Logging into Instagram...",
      processedCount,
      totalCount,
    });

    const loginResult = await loginToInstagram(driver, {
      username: options.credentials.username,
      password: options.credentials.password,
      verificationCode: options.credentials.verificationCode,
      credentialId: options.credentialId,
      existingCookies: options.existingCookies,
    });

    if (loginResult.needs2FA) {
      await onProgress({
        type: "2fa_required",
        credentialId: options.credentialId,
        message: "Verification code required. Check your email or authenticator app.",
      });

      if (!options.credentialId) {
        await onProgress({ type: "error", error: "No credential ID for 2FA challenge" });
        return;
      }

      try {
        const code = await createChallenge(options.credentialId);

        await onProgress({ type: "status", message: "Submitting verification code..." });

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

          if (options.credentialId) {
            const { extractCookies } = await import("./driver");
            const { saveSession } = await import("@/lib/db/utils/instagram");
            const cookies = await extractCookies(driver);
            await saveSession(options.credentialId, {
              cookies,
              userAgent: "Chrome",
              savedAt: new Date(),
              expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            });
          }
        } else {
          await onProgress({ type: "error", error: "No focused element for 2FA code" });
          return;
        }
      } catch {
        await onProgress({ type: "error", error: "2FA challenge timed out" });
        return;
      }
    } else if (!loginResult.success) {
      await onProgress({ type: "error", error: `Login failed: ${loginResult.error}` });
      return;
    }

    await onProgress({
      type: "status",
      message: "Login successful — starting extraction",
      processedCount,
      totalCount,
    });

    for (let i = 0; i < options.usernames.length; i++) {
      const targetUsername = options.usernames[i];
      processedCount = i + 1;

      const alreadyScraped = await isProfileAlreadyScraped(targetUsername);
      if (alreadyScraped) {
        await onProgress({
          type: "skipped",
          profileUsername: targetUsername,
          message: `@${targetUsername} already scraped — skipping`,
          processedCount,
          totalCount,
        });
        continue;
      }

      await onProgress({
        type: "status",
        profileUsername: targetUsername,
        message: `[${processedCount}/${totalCount}] Extracting followers for @${targetUsername}...`,
        processedCount,
        totalCount,
      });

      const ctx: VariableContext = {
        credentials: options.credentials,
        profile: { username: targetUsername },
      };

      const engine = new ScrapingEngine(driver, ctx);

      const navDef = await engine.loadDefinition(NAVIGATE_YAML);
      const navResult = await engine.execute(navDef);

      const navError = navResult.checkProfileError as { error?: string } | undefined;
      if (navError?.error === "PROFILE_NOT_FOUND") {
        invalidCount++;
        await onProgress({
          type: "invalid",
          profileUsername: targetUsername,
          message: `@${targetUsername} not found`,
          invalidCount,
          processedCount,
          totalCount,
        });
        continue;
      }

      const privateError = navResult.checkPrivateProfile as { error?: string } | undefined;
      if (privateError?.error === "PROFILE_IS_PRIVATE") {
        await markProfilePrivate(targetUsername);
        await onProgress({
          type: "private",
          profileUsername: targetUsername,
          message: `@${targetUsername} is private — skipping`,
          processedCount,
          totalCount,
        });
        continue;
      }

      await onProgress({
        type: "status",
        profileUsername: targetUsername,
        message: `[${processedCount}/${totalCount}] Opening followers dialog for @${targetUsername}...`,
        processedCount,
        totalCount,
      });

      const navProfilePic = navResult.extractProfilePic as string | undefined

      const followersDef = await engine.loadDefinition(FOLLOWERS_YAML);
      let rawFollowers: Array<{ username: string; avatarUrl?: string }> = [];

      try {
        const followersResult = await engine.execute(followersDef);
        rawFollowers = (followersResult.finalExtract as Array<{ username: string; avatarUrl?: string }>) || [];
      } catch (err: any) {
        const isPrivate = await driver.executeScript(
          "return document.body.innerText.toLowerCase().includes('this profile is private')",
        );
        if (isPrivate) {
          await markProfilePrivate(targetUsername);
          await onProgress({
            type: "private",
            profileUsername: targetUsername,
            message: `@${targetUsername} is private — skipping`,
            processedCount,
            totalCount,
          });
          continue;
        }
        await onProgress({
          type: "status",
          profileUsername: targetUsername,
          message: `@${targetUsername}: dialog error — ${err.message || "timeout"} — skipping`,
          processedCount,
          totalCount,
        });
        continue;
      }

      const existingFollowers = await getExistingFollowerUsernames(targetUsername);
      let profileCount = 0;

      for (const entry of rawFollowers) {
        const trimmed = entry.username.trim();
        if (!trimmed) continue;

        if (existingFollowers.has(trimmed)) {
          duplicateCount++;
          continue;
        }
        existingFollowers.add(trimmed);

        await upsertFollower(targetUsername, trimmed, undefined, entry.avatarUrl);
        profileCount++;
        totalFollowers++;

        await onProgress({
          type: "follower",
          profileUsername: targetUsername,
          followerUsername: trimmed,
          count: profileCount,
          totalFollowers,
          duplicateCount,
          invalidCount,
          processedCount,
          totalCount,
        });
      }

      await updateTargetProfileScraped(targetUsername, profileCount, navProfilePic);

      await onProgress({
        type: "status",
        profileUsername: targetUsername,
        message: `Done — extracted ${profileCount} followers from @${targetUsername}`,
        totalFollowers,
        duplicateCount,
        invalidCount,
        processedCount,
        totalCount,
      });

      if ((i + 1) % REEL_SCROLL_INTERVAL === 0 && i < options.usernames.length - 1) {
        await onProgress({
          type: "status",
          message: `Scrolling reels to avoid detection (${processedCount}/${totalCount} profiles done)...`,
          processedCount,
          totalCount,
        });

        const reelDef = await engine.loadDefinition(REELS_YAML);
        await engine.execute(reelDef);

        await onProgress({
          type: "status",
          message: `Reel scroll done — continuing extraction`,
          processedCount,
          totalCount,
        });
      }
    }

    await onProgress({
      type: "done",
      message: "Extraction complete",
      totalFollowers,
      invalidCount,
      duplicateCount,
      processedCount,
      totalCount,
    });
  } catch (error: any) {
    await onProgress({
      type: "error",
      error: error.message || "Unknown error during extraction",
      processedCount,
      totalCount,
    });
  } finally {
    await driver.quit();
  }
}
