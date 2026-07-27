export class ProxyManager {
  private proxies: string[];
  private currentIndex = 0;

  constructor() {
    const raw = process.env.PROXY_LIST || "";
    this.proxies = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  get hasProxies(): boolean {
    return this.proxies.length > 0;
  }

  get current(): string | null {
    if (this.proxies.length === 0) return null;
    return this.proxies[this.currentIndex] ?? null;
  }

  get proxyIndex(): number {
    return this.currentIndex;
  }

  get totalProxies(): number {
    return this.proxies.length;
  }

  rotate(): string | null {
    if (this.proxies.length === 0) return null;
    this.currentIndex = (this.currentIndex + 1) % this.proxies.length;
    return this.current;
  }
}
