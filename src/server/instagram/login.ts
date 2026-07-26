import type { WebDriver } from "selenium-webdriver";

import { ScrapingEngine } from "./scraping-engine";
import type { VariableContext } from "./types";
import path from "node:path";

const LOGIN_YAML = path.resolve(process.cwd(), "src/server/instagram/actions/login.yaml");

export interface LoginOptions {
  username: string;
  password: string;
  verificationCode?: string;
}

export async function loginToInstagram(
  driver: WebDriver,
  options: LoginOptions,
): Promise<{ success: boolean; error?: string }> {
  const ctx: VariableContext = {
    credentials: {
      username: options.username,
      password: options.password,
      verificationCode: options.verificationCode,
    },
    profile: { username: "" },
  };

  const engine = new ScrapingEngine(driver, ctx);
  const definition = await engine.loadDefinition(LOGIN_YAML);

  try {
    await engine.execute(definition);
    return { success: true };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || "Unknown error during login",
    };
  }
}
