import { updateTargetProfileScraped, upsertFollower } from "@/lib/db/utils/instagram";

import { createDriver } from "./driver";
import { loginToInstagram } from "./login";
import { ScrapingEngine } from "./scraping-engine";
import type { VariableContext } from "./types";
import path from "node:path";

const ACTIONS_DIR = path.resolve(process.cwd(), "src/server/instagram/actions");
const NAVIGATE_YAML = path.join(ACTIONS_DIR, "navigate-profile.yaml");
const FOLLOWERS_YAML = path.join(ACTIONS_DIR, "followers.yaml");

export interface ProgressEvent {
  type: "status" | "follower" | "invalid" | "duplicate" | "done" | "error";
  profileUsername?: string;
  message?: string;
  followerUsername?: string;
  count?: number;
  totalFollowers?: number;
  invalidCount?: number;
  duplicateCount?: number;
  error?: string;
}

export type ProgressCallback = (event: ProgressEvent) => void | Promise<void>;

export async function extractFollowersStream(
  credentials: { username: string; password: string; verificationCode?: string },
  usernames: string[],
  onProgress: ProgressCallback,
): Promise<void> {
  const driver = await createDriver();

  let totalFollowers = 0;
  let invalidCount = 0;
  let duplicateCount = 0;

  try {
    await onProgress({ type: "status", message: "Logging into Instagram..." });

    const loginResult = await loginToInstagram(driver, credentials);
    if (!loginResult.success) {
      await onProgress({
        type: "error",
        error: `Login failed: ${loginResult.error}`,
      });
      return;
    }

    await onProgress({ type: "status", message: "Login successful" });

    for (const targetUsername of usernames) {
      await onProgress({
        type: "status",
        profileUsername: targetUsername,
        message: `Extracting followers for @${targetUsername}...`,
      });

      const ctx: VariableContext = {
        credentials,
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
        });
        continue;
      }

      await onProgress({
        type: "status",
        profileUsername: targetUsername,
        message: `Scrolling followers list for @${targetUsername}...`,
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
      });
    }

    await onProgress({
      type: "done",
      message: "Extraction complete",
      totalFollowers,
      invalidCount,
      duplicateCount,
    });
  } catch (error: any) {
    await onProgress({
      type: "error",
      error: error.message || "Unknown error during extraction",
    });
  } finally {
    await driver.quit();
  }
}
