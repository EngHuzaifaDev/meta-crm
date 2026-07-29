import { ProxyAgent, request as undiciRequest } from "undici";

let cachedProxyAgent: ProxyAgent | null = null;
let cachedProxyHost: string | null = null;

export interface ProxyConfig {
  host: string;
  port: number;
  username: string;
  password: string;
}

export function parseProxyUrl(urlString?: string): ProxyConfig | null {
  if (!urlString) return null;
  let normalized = urlString;
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(normalized)) {
    normalized = `http://${normalized}`;
  }
  try {
    const url = new URL(normalized);
    return {
      host: url.hostname,
      port: Number(url.port),
      username: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
    };
  } catch {
    return null;
  }
}

export function getProxyUrl(): string | undefined {
  return process.env.PROXY_URL || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || undefined;
}

export function getProxyHost(): string | null {
  if (cachedProxyHost) return cachedProxyHost;
  const rawUrl = getProxyUrl();
  if (!rawUrl) return null;
  let normalized = rawUrl;
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(normalized)) {
    normalized = `http://${normalized}`;
  }
  try {
    const url = new URL(normalized);
    cachedProxyHost = url.hostname;
    return cachedProxyHost;
  } catch {
    return null;
  }
}

function getOrCreateProxyAgent(): ProxyAgent | null {
  if (cachedProxyAgent) return cachedProxyAgent;
  const proxyUrl = getProxyUrl();
  if (!proxyUrl) return null;
  const normalized = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(proxyUrl) ? proxyUrl : `http://${proxyUrl}`;
  cachedProxyAgent = new ProxyAgent(normalized);
  return cachedProxyAgent;
}

export function resetProxyAgent(): void {
  cachedProxyAgent = null;
  cachedProxyHost = null;
}

export async function verifyProxyIP(): Promise<{
  ip: string;
  region?: string;
  ok: boolean;
  error?: string;
}> {
  const agent = getOrCreateProxyAgent();
  if (!agent) {
    return { ip: "(direct)", ok: true };
  }

  try {
    const { statusCode, body } = await undiciRequest("https://api.ip.cc", {
      dispatcher: agent,
      method: "GET",
      headers: { "User-Agent": "curl/8.0" },
      headersTimeout: 30000,
    });

    if (statusCode !== 200) {
      return { ip: "(error)", ok: false, error: `IP check returned ${statusCode}` };
    }

    const text = await body.text();
    let ip = "";
    try {
      const data = JSON.parse(text);
      ip = data.ip || data.origin || data.address || "unknown";
    } catch {
      ip = text.trim();
    }
    return { ip, ok: true };
  } catch (err: any) {
    const proxyHost = getProxyHost() || "unknown";
    if (err.message?.includes("407")) {
      return {
        ip: "(error)",
        ok: false,
        error: `Proxy authentication failed (407) at ${proxyHost} — check PROXY_URL credentials`,
      };
    }
    return { ip: "(error)", ok: false, error: `${err.message} (proxy: ${proxyHost})` };
  }
}

export async function proxyFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const agent = getOrCreateProxyAgent();
  if (!agent) {
    return fetch(url, options as RequestInit);
  }

  const headers: Record<string, string> = {};
  if (options.headers) {
    for (const [k, v] of Object.entries(options.headers as Record<string, string>)) {
      headers[k] = String(v);
    }
  }

  try {
    const { statusCode, body } = await undiciRequest(url, {
      dispatcher: agent,
      method: (options.method as string) || "GET",
      headers,
      body: options.body as string | Buffer | undefined,
      headersTimeout: 30000,
    });

    const text = await body.text();
    return new Response(text, { status: statusCode });
  } catch (err: any) {
    const proxyHost = getProxyHost() || "unknown";
    if (err.message?.includes("407")) {
      throw new Error(`Proxy authentication failed (407) at ${proxyHost} — check PROXY_URL credentials`);
    }
    throw new Error(`Proxy request failed: ${err.message} (proxy: ${proxyHost})`);
  }
}
