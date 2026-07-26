import { WebDriver } from 'selenium-webdriver';
import { ScrapingEngine } from './scraping-engine';
import { VariableContext } from './types';
import { injectCookies, extractCookies } from './driver';
import { saveSession, clearSession } from '@/lib/db/utils/instagram';
import path from 'path';

const LOGIN_YAML = path.resolve(process.cwd(), 'src/server/instagram/actions/login.yaml');

export interface LoginOptions {
  username: string;
  password: string;
  verificationCode?: string;
  credentialId?: string;
  existingCookies?: Array<{ name: string; value: string; domain: string; path: string; httpOnly?: boolean; secure?: boolean; expiry?: number }>;
}

export interface LoginResult {
  success: boolean;
  error?: string;
  needs2FA?: boolean;
  cookies?: Array<{ name: string; value: string; domain: string; path: string; httpOnly?: boolean; secure?: boolean; expiry?: number }>;
}

export async function loginToInstagram(
  driver: WebDriver,
  options: LoginOptions,
): Promise<LoginResult> {
  if (options.existingCookies && options.existingCookies.length > 0) {
    try {
      await injectCookies(driver, options.existingCookies);
      await driver.get('https://www.instagram.com/');
      await driver.sleep(3000);

      const url = await driver.getCurrentUrl();
      if (!url.includes('/accounts/login')) {
        const cookies = await extractCookies(driver);
        return { success: true, cookies };
      }
    } catch {
      // cookies expired or invalid — fall through to full login
    }
  }

  const ctx: VariableContext = {
    credentials: {
      username: options.username,
      password: options.password,
      verificationCode: options.verificationCode,
    },
    profile: { username: '' },
  };

  const engine = new ScrapingEngine(driver, ctx);
  const definition = await engine.loadDefinition(LOGIN_YAML);

  try {
    await engine.execute(definition);
  } catch (error: any) {
    if (error.message?.includes('verificationCode')) {
      return {
        success: false,
        needs2FA: true,
        error: '2FA code required',
      };
    }
    return {
      success: false,
      error: error.message || 'Unknown error during login',
    };
  }

  const currentUrl = await driver.getCurrentUrl();
  if (currentUrl.includes('/accounts/login') || currentUrl.includes('/challenge')) {
    const pageText = await driver.findElement({ tagName: 'body' }).getText();
    if (pageText.includes('Enter confirmation code') || pageText.includes('verification')) {
      return { success: false, needs2FA: true, error: '2FA code required' };
    }
    if (pageText.includes('challenge')) {
      return { success: false, error: 'Instagram challenge required — login from browser first' };
    }
    return { success: false, error: 'Login failed — still on login page' };
  }

  const cookies = await extractCookies(driver);

  if (options.credentialId) {
    await saveSession(options.credentialId, {
      cookies,
      userAgent: 'Chrome',
      savedAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
  }

  return { success: true, cookies };
}
