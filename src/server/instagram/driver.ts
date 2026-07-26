import { Builder, type WebDriver } from "selenium-webdriver";

const SELENIUM_GRID_URL = process.env.SELENIUM_GRID_URL || "http://selenium-hub:4444";

export async function createDriver(): Promise<WebDriver> {
  const driver = await new Builder()
    .usingServer(SELENIUM_GRID_URL)
    .withCapabilities({
      browserName: "chrome",
      "goog:chromeOptions": {
        args: [
          "--disable-blink-features=AutomationControlled",
          "--no-sandbox",
          "--disable-dev-shm-usage",
          "--window-size=1920,1080",
          "--disable-gpu",
        ],
      },
    })
    .build();

  await driver.executeScript("Object.defineProperty(navigator, 'webdriver', { get: () => undefined })");

  return driver;
}
