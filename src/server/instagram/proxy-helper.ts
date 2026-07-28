import { ProxyAgent, request as undiciRequest } from "undici";

let cachedProxyAgent: ProxyAgent | null = null;

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

function getOrCreateProxyAgent(): ProxyAgent | null {
  if (cachedProxyAgent) return cachedProxyAgent;
  const proxyUrl = getProxyUrl();
  if (!proxyUrl) return null;
  const normalized = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(proxyUrl) ? proxyUrl : `http://${proxyUrl}`;
  cachedProxyAgent = new ProxyAgent(normalized);
  return cachedProxyAgent;
}

function buildChromeProxyUrl(config: ProxyConfig): string {
  return `--proxy-server=http://${config.host}:${config.port}`;
}

async function buildProxyAuthExtension(config: ProxyConfig): Promise<string | null> {
  if (!config.username && !config.password) return null;
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();

  zip.file(
    "manifest.json",
    JSON.stringify({
      name: "Proxy Auth",
      version: "1.0.0",
      manifest_version: 3,
      permissions: ["webRequest", "webRequestAuthProvider"],
      host_permissions: ["<all_urls>"],
      background: { service_worker: "background.js" },
    }),
  );

  zip.file(
    "background.js",
    `chrome.webRequest.onAuthRequired.addListener(
  (details, callback) => {
    callback({
      authCredentials: {
        username: ${JSON.stringify(config.username)},
        password: ${JSON.stringify(config.password)}
      }
    })
  },
  { urls: ["<all_urls>"] },
  ["asyncBlocking"]
)`,
  );

  const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return buf.toString("base64");
}

export async function buildChromeProxyOptions(): Promise<{
  args: string[];
  extensions: string[];
}> {
  const url = getProxyUrl();
  if (!url) return { args: [], extensions: [] };

  const config = parseProxyUrl(url);
  if (!config) return { args: [], extensions: [] };

  const args: string[] = [buildChromeProxyUrl(config)];
  const extensions: string[] = [];
  const ext = await buildProxyAuthExtension(config);
  if (ext) extensions.push(ext);

  return { args, extensions };
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
    return { ip: "(error)", ok: false, error: err.message };
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
    throw new Error(`Proxy request failed: ${err.message}`);
  }
}
