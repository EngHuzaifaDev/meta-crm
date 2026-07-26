import { createDriver } from "./driver";
import { loginToInstagram } from "./login";
import { ScrapingEngine } from "./scraping-engine";
import type { VariableContext } from "./types";
import { upsertFollower, updateTargetProfileScraped } from "@/lib/db/utils/instagram";
import path from "node:path";

const ACTIONS_DIR = path.resolve(process.cwd(), "src/server/instagram/actions");
const NAVIGATE_YAML = path.join(ACTIONS_DIR, "navigate-profile.yaml");
const FOLLOWERS_YAML = path.join(ACTIONS_DIR, "followers.yaml");
const REELS_YAML = path.join(ACTIONS_DIR, "reels.yaml");

const REEL_SCROLL_INTERVAL = 5;

export interface ProgressEvent {
  type: "status" | "follower" | "invalid" | "duplicate" | "done" | "error" | "2fa_required";
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
      await onProgress({ type: "error", error: "2FA required — login failed" });
      return;
    }

    if (!loginResult.success) {
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

      await onProgress({
        type: "status",
        profileUsername: targetUsername,
        message: `[${processedCount}/${totalCount}] Scrolling followers list for @${targetUsername}...`,
        processedCount,
        totalCount,
      });

      const followersDef = await engine.loadDefinition(FOLLOWERS_YAML);
      const followersResult = await engine.execute(followersDef);

      const rawFollowers = (followersResult.finalExtract as string[]) || [];
      const seen = new Set<string>();
      let profileCount = 0;

      for (const username of rawFollowers) {
        const trimmed = username.trim();
        if (!trimmed) continue;

        if (seen.has(trimmed)) {
          duplicateCount++;
          continue;
        }
        seen.add(trimmed);

        await upsertFollower(targetUsername, trimmed);
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

      await updateTargetProfileScraped(targetUsername, profileCount);

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
