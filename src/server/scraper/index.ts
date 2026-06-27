// server/scraper/index.ts
import { chromium, Browser } from 'playwright';
import { mongodbInstance as db } from '@/lib/db/mongodb';

// --------------------------
// 1. Concurrency control (single‑CPU friendly)
// --------------------------
const MAX_CONCURRENT = 3;
let activeCount = 0;
const waitingQueue: Array<() => void> = [];

async function acquire(): Promise<void> {
    return new Promise((resolve) => {
        if (activeCount < MAX_CONCURRENT) {
            activeCount++;
            resolve();
        } else {
            waitingQueue.push(resolve);
        }
    });
}

function release(): void {
    if (waitingQueue.length > 0) {
        const next = waitingQueue.shift()!;
        next();
    } else {
        activeCount--;
    }
}

// --------------------------
// 2. Shared browser (lazy init)
// --------------------------
let browser: Browser | null = null;
let browserInit: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
    if (browser) return browser;
    if (!browserInit) {
        browserInit = chromium.launch({
            headless: true,
            executablePath: '/usr/bin/chromium-browser', // 👈 use system Chromium
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });
    }
    browser = await browserInit;
    return browser;
}

// --------------------------
// 3. Text extraction (runs in page context)
// --------------------------
function extractVisibleText(): string {
    const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode: (node) => {
                const parent = node.parentElement;
                if (!parent) return NodeFilter.FILTER_REJECT;
                const tag = parent.tagName.toLowerCase();
                if (['script', 'style', 'noscript', 'svg'].includes(tag)) {
                    return NodeFilter.FILTER_REJECT;
                }
                const style = window.getComputedStyle(parent);
                if (style.display === 'none' || style.visibility === 'hidden') {
                    return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            },
        }
    );

    let result = '';
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
        result += node.textContent?.trim() + ' ';
    }
    return result.replace(/\s+/g, ' ').trim();
}

// --------------------------
// 4. Main exported function
// --------------------------
export interface ScrapeResult {
    success: boolean;
    text?: string;
    finalUrl?: string;
    error?: {
        code:
        | 'URL_INVALID'
        | 'PAGE_NOT_FOUND'
        | 'TOO_MANY_REDIRECTS'
        | 'TIMEOUT'
        | 'NETWORK_ERROR'
        | 'UNKNOWN_ERROR';
        message: string;
        details?: unknown;
    };
}

interface GetContentOptions {
    leadId?: string;
    userId?: string;
    maxRedirects?: number; // default 5
    timeout?: number;      // default 30000 ms
    allowedDomains?: string[];
}

export async function getContent(
    url: string,
    options: GetContentOptions = {}
): Promise<ScrapeResult> {
    // ---- Validate URL ----
    let parsedUrl: URL;
    try {
        parsedUrl = new URL(url);
    } catch {
        return {
            success: false,
            error: {
                code: 'URL_INVALID',
                message: 'The provided URL is malformed',
                details: { originalUrl: url },
            },
        };
    }

    // ---- Domain whitelist ----
    if (options.allowedDomains?.length) {
        const domain = parsedUrl.hostname;
        if (!options.allowedDomains.some((d) => domain.includes(d))) {
            return {
                success: false,
                error: {
                    code: 'URL_INVALID',
                    message: `Domain not allowed: ${domain}`,
                },
            };
        }
    }

    await acquire();
    try {
        const browserInstance = await getBrowser();
        const context = await browserInstance.newContext();
        const page = await context.newPage();

        // ---- Redirect counter (manual fallback) ----
        let redirectCount = 0;
        const maxRedirects = options.maxRedirects ?? 5;
        const timeout = options.timeout ?? 30000;

        // Listen for redirects on the main navigation
        page.on('response', (response) => {
            const status = response.status();
            if (
                status >= 300 && status < 400 &&
                response.request().isNavigationRequest()
            ) {
                redirectCount++;
                if (redirectCount > maxRedirects) {
                    console.log('redirect exceeded for leadID: ', options.leadId)
                }
            }
        });

        try {
            // ---- Navigate with built‑in redirect limit (if available) ----
            const response = await page.goto(url, {
                waitUntil: 'networkidle',
                timeout,
            });

            // ---- Check for too many redirects (manual) ----
            if (redirectCount > maxRedirects) {
                throw new Error('TOO_MANY_REDIRECTS');
            }

            // ---- Check for 404 / 403 / etc. ----
            if (response) {
                const status = response.status();
                if (status === 404) {
                    return {
                        success: false,
                        error: {
                            code: 'PAGE_NOT_FOUND',
                            message: `Page returned 404 Not Found`,
                            details: { url, status },
                        },
                    };
                }
                // You can add handling for other statuses if needed
                if (status >= 400) {
                    return {
                        success: false,
                        error: {
                            code: 'NETWORK_ERROR',
                            message: `Server responded with ${status}`,
                            details: { url, status },
                        },
                    };
                }
            }

            // ---- Extract text ----
            const text = await page.evaluate(extractVisibleText);
            const finalUrl = page.url();

            // ---- Persist to DB (if leadId and userId provided) ----
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
            // ---- Map Playwright errors to our error codes ----
            const errMsg = error.message || '';
            if (errMsg.includes('Timeout') || errMsg.includes('timeout')) {
                return {
                    success: false,
                    error: {
                        code: 'TIMEOUT',
                        message: `Navigation timed out after ${timeout}ms`,
                        details: { url },
                    },
                };
            }
            if (errMsg.includes('TOO_MANY_REDIRECTS') || errMsg.includes('ERR_TOO_MANY_REDIRECTS')) {
                return {
                    success: false,
                    error: {
                        code: 'TOO_MANY_REDIRECTS',
                        message: `Exceeded maximum redirects (${maxRedirects})`,
                        details: { url, redirectCount },
                    },
                };
            }
            if (errMsg.includes('ERR_NAME_NOT_RESOLVED') || errMsg.includes('net::ERR')) {
                return {
                    success: false,
                    error: {
                        code: 'NETWORK_ERROR',
                        message: `Network error: ${errMsg}`,
                        details: { url },
                    },
                };
            }
            // Fallback for any other error
            return {
                success: false,
                error: {
                    code: 'UNKNOWN_ERROR',
                    message: errMsg,
                    details: { url, stack: error.stack },
                },
            };
        } finally {
            await context.close();
        }
    } finally {
        release();
    }
}

// --------------------------
// 5. Database persistence
// --------------------------
async function saveScrapedContent(data: {
    leadId: string;
    userId: string;
    url: string;
    text: string;
    finalUrl: string;
}) {

    await db.collection('scrapedContents').insertOne({
        leadId: data.leadId,
        userId: data.userId,
        url: data.url,
        text: data.text,
        finalUrl: data.finalUrl,
        createdAt: new Date(),
        updatedAt: new Date(),
    });
}

// --------------------------
// 6. Optional: close browser on shutdown
// --------------------------
export async function closeScraper() {
    if (browser) {
        await browser.close();
        browser = null;
    }
}