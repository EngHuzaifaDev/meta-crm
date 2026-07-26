// server/scraper/index.ts
import { mongodbInstance as db } from "@/lib/db/mongodb";

export interface ScrapeResult {
  success: boolean;
  text?: string;
  finalUrl?: string;
  error?: {
    code: "URL_INVALID" | "PAGE_NOT_FOUND" | "TOO_MANY_REDIRECTS" | "TIMEOUT" | "NETWORK_ERROR" | "UNKNOWN_ERROR";
    message: string;
    details?: unknown;
  };
}

interface GetContentOptions {
  leadId?: string;
  userId?: string;
  maxRedirects?: number;
  timeout?: number;
  allowedDomains?: string[];
}

export async function getContent(url: string, options: GetContentOptions = {}): Promise<ScrapeResult> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return {
      success: false,
      error: {
        code: "URL_INVALID",
        message: "The provided URL is malformed",
        details: { originalUrl: url },
      },
    };
  }

  if (options.allowedDomains?.length) {
    const domain = parsedUrl.hostname;
    if (!options.allowedDomains.some((d) => domain.includes(d))) {
      return {
        success: false,
        error: {
          code: "URL_INVALID",
          message: `Domain not allowed: ${domain}`,
        },
      };
    }
  }

  const timeout = options.timeout ?? 30000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    let redirectCount = 0;
    const maxRedirects = options.maxRedirects ?? 5;

    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "manual",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
    });

    let finalUrl = url;
    let currentResponse = response;

    while (currentResponse.status >= 300 && currentResponse.status < 400) {
      redirectCount++;
      if (redirectCount > maxRedirects) {
        return {
          success: false,
          error: {
            code: "TOO_MANY_REDIRECTS",
            message: `Exceeded maximum redirects (${maxRedirects})`,
            details: { url: finalUrl, redirectCount },
          },
        };
      }

      const location = currentResponse.headers.get("location");
      if (!location) break;

      finalUrl = new URL(location, finalUrl).href;
      currentResponse = await fetch(finalUrl, {
        signal: controller.signal,
        redirect: "manual",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });
    }

    if (currentResponse.status === 404) {
      return {
        success: false,
        error: {
          code: "PAGE_NOT_FOUND",
          message: "Page returned 404 Not Found",
          details: { url, status: 404 },
        },
      };
    }

    if (currentResponse.status >= 400) {
      return {
        success: false,
        error: {
          code: "NETWORK_ERROR",
          message: `Server responded with ${currentResponse.status}`,
          details: { url, status: currentResponse.status },
        },
      };
    }

    const text = await currentResponse.text();

    if (options.leadId && options.userId) {
      await saveScrapedContent({
        leadId: options.leadId,
        userId: options.userId,
        url,
        text,
        finalUrl,
      });
    }

    return { success: true, text, finalUrl };
  } catch (error: any) {
    const errMsg = error.message || "";
    if (error.name === "AbortError" || errMsg.includes("timeout")) {
      return {
        success: false,
        error: {
          code: "TIMEOUT",
          message: `Request timed out after ${timeout}ms`,
          details: { url },
        },
      };
    }
    if (errMsg.includes("ENOTFOUND") || errMsg.includes("ECONNREFUSED") || errMsg.includes("ERR_")) {
      return {
        success: false,
        error: {
          code: "NETWORK_ERROR",
          message: `Network error: ${errMsg}`,
          details: { url },
        },
      };
    }
    return {
      success: false,
      error: {
        code: "UNKNOWN_ERROR",
        message: errMsg,
        details: { url, stack: error.stack },
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

async function saveScrapedContent(data: {
  leadId: string;
  userId: string;
  url: string;
  text: string;
  finalUrl: string;
}) {
  await db.collection("scrapedContents").insertOne({
    leadId: data.leadId,
    userId: data.userId,
    url: data.url,
    text: data.text,
    finalUrl: data.finalUrl,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}
