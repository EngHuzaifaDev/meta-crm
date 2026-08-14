const KEY = "devCollectiveExport";
const TARGET_KEY = "devFollowerTargetM";
const DEFAULT_TARGET_M = 16;

export function getCollectiveExport(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(KEY) === "1";
}

export function setCollectiveExport(value: boolean): void {
  localStorage.setItem(KEY, value ? "1" : "0");
}

export function getFollowerTargetM(): number {
  if (typeof window === "undefined") return DEFAULT_TARGET_M;
  const raw = parseFloat(localStorage.getItem(TARGET_KEY) ?? "");
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TARGET_M;
}

export function setFollowerTargetM(value: number): void {
  localStorage.setItem(TARGET_KEY, String(value));
}
