import { updateTargetProfileScraped, upsertFollower } from "@/lib/db/utils/instagram";

import { createDriver } from "./driver";
import { loginToInstagram } from "./login";
import { ScrapingEngine } from "./scraping-engine";
import type { ExtractionResult, VariableContext } from "./types";
import path from "node:path";

const ACTIONS_DIR = path.resolve(process.cwd(), "src/server/instagram/actions");
const NAVIGATE_YAML = path.join(ACTIONS_DIR, "navigate-profile.yaml");
const FOLLOWERS_YAML = path.join(ACTIONS_DIR, "followers.yaml");

export interface ExtractFollowersOptions {
  credentials: {
    username: string;
    password: string;
    verificationCode?: string;
  };
  targetProfile: string;
  maxFollowers?: number;
}

export async function extractFollowers(options: ExtractFollowersOptions): Promise<ExtractionResult> {
  const driver = await createDriver();

  try {
    const loginResult = await loginToInstagram(driver, options.credentials);
    if (!loginResult.success) {
      return {
        profileUsername: options.targetProfile,
        followers: [],
        followerCount: 0,
        scrapedAt: new Date(),
        success: false,
        error: `Login failed: ${loginResult.error}`,
      };
    }

    const ctx: VariableContext = {
      credentials: options.credentials,
      profile: { username: options.targetProfile },
    };

    const engine = new ScrapingEngine(driver, ctx);

    const navDef = await engine.loadDefinition(NAVIGATE_YAML);
    const navResult = await engine.execute(navDef);

    const navError = navResult.checkProfileError as { error?: string } | undefined;
    if (navError?.error === "PROFILE_NOT_FOUND") {
      return {
        profileUsername: options.targetProfile,
        followers: [],
        followerCount: 0,
        scrapedAt: new Date(),
        success: false,
        error: `Profile @${options.targetProfile} not found`,
      };
    }

    const followersDef = await engine.loadDefinition(FOLLOWERS_YAML);
    const followersResult = await engine.execute(followersDef);

    const rawFollowers = (followersResult.finalExtract as string[]) || [];
    const uniqueFollowers = [...new Set(rawFollowers)].filter(Boolean);

    const maxFollowers = options.maxFollowers ?? uniqueFollowers.length;
    const followers = uniqueFollowers.slice(0, maxFollowers);

    for (const username of followers) {
      await upsertFollower(options.targetProfile, username);
    }

    await updateTargetProfileScraped(options.targetProfile, followers.length);

    return {
      profileUsername: options.targetProfile,
      followers,
      followerCount: followers.length,
      scrapedAt: new Date(),
      success: true,
    };
  } catch (error: any) {
    return {
      profileUsername: options.targetProfile,
      followers: [],
      followerCount: 0,
      scrapedAt: new Date(),
      success: false,
      error: error.message || "Unknown error during extraction",
    };
  } finally {
    await driver.quit();
  }
}
