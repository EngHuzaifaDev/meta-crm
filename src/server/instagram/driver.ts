import { Builder, type WebDriver } from "selenium-webdriver";

import { buildChromeProxyOptions } from "./proxy-helper";

const SELENIUM_GRID_URL = process.env.SELENIUM_GRID_URL || "http://selenium-hub:4444";

export async function createDriver(): Promise<WebDriver> {
  const proxyOptions = await buildChromeProxyOptions();

  const chromeOptions: { args: string[]; extensions?: string[] } = {
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--window-size=1920,1080",
      "--disable-gpu",
      "--lang=en-US",
      ...proxyOptions.args,
    ],
  };

  if (proxyOptions.extensions.length > 0) {
    chromeOptions.extensions = proxyOptions.extensions;
  }

  const driver = await new Builder()
    .usingServer(SELENIUM_GRID_URL)
    .withCapabilities({
      browserName: "chrome",
      "goog:chromeOptions": chromeOptions,
    })
    .build();

  await driver.executeScript("Object.defineProperty(navigator, 'webdriver', { get: () => undefined })");

  return driver;
}

export async function injectCookies(
  driver: WebDriver,
  cookies: Array<{ name: string; value: string; domain: string; path?: string; httpOnly?: boolean; secure?: boolean }>,
): Promise<void> {
  await driver.get("https://www.instagram.com/");
  for (const cookie of cookies) {
    try {
      await driver.manage().addCookie({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path || "/",
        httpOnly: cookie.httpOnly ?? false,
        secure: cookie.secure ?? true,
      });
    } catch {
      // skip cookies that can't be set (e.g. httpOnly from other sessions)
    }
  }
}

export async function extractCookies(driver: WebDriver): Promise<
  Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    httpOnly?: boolean;
    secure?: boolean;
    expiry?: number;
  }>
> {
  const cookies = await driver.manage().getCookies();
  return cookies.map((c: any) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    httpOnly: c.httpOnly,
    secure: c.secure,
    expiry: c.expiry,
  }));
}
