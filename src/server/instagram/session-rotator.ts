import type { CookieObject, SessionFromCookies } from "./cookie-session";
import { buildInstagramHeaders, parseCookies } from "./cookie-session";

export const MAX_REQUESTS_PER_HOUR = 175;
export const SOFT_LIMIT = 170;
export const COOLDOWN_MS = 3600_000;

export interface SessionInput {
  label: string;
  cookies: CookieObject[];
}

export interface TrackedSession {
  label: string;
  cookies: CookieObject[];
  parsed: SessionFromCookies;
  headers: Record<string, string>;
  requestCount: number;
  hourStart: number;
  coolingDown: boolean;
  cooldownUntil: number;
}

export function createTrackedSessions(inputs: SessionInput[]): TrackedSession[] {
  return inputs.map((input) => {
    const parsed = parseCookies(input.cookies);
    return {
      label: input.label,
      cookies: input.cookies,
      parsed,
      headers: buildInstagramHeaders(parsed, input.cookies),
      requestCount: 0,
      hourStart: Date.now(),
      coolingDown: false,
      cooldownUntil: 0,
    };
  });
}

function resetHourIfNeeded(session: TrackedSession): void {
  const now = Date.now();
  if (now - session.hourStart >= COOLDOWN_MS) {
    session.requestCount = 0;
    session.hourStart = now;
    session.coolingDown = false;
    session.cooldownUntil = 0;
  }
}

export function getNextSession(sessions: TrackedSession[]): TrackedSession | null {
  const now = Date.now();
  let best: TrackedSession | null = null;

  for (const s of sessions) {
    resetHourIfNeeded(s);

    if (s.coolingDown && now >= s.cooldownUntil) {
      s.coolingDown = false;
      s.cooldownUntil = 0;
    }

    if (s.coolingDown) continue;
    if (s.requestCount >= SOFT_LIMIT) continue;

    if (!best || s.requestCount < best.requestCount) {
      best = s;
    }
  }

  return best;
}

export function getMinCooldownMs(sessions: TrackedSession[]): number {
  const now = Date.now();
  let min = Infinity;
  for (const s of sessions) {
    resetHourIfNeeded(s);
    if (s.coolingDown && s.cooldownUntil > now) {
      min = Math.min(min, s.cooldownUntil - now);
    }
    if (!s.coolingDown && s.requestCount >= MAX_REQUESTS_PER_HOUR) {
      const resetIn = COOLDOWN_MS - (now - s.hourStart);
      min = Math.min(min, resetIn);
    }
  }
  return min === Infinity ? COOLDOWN_MS : min;
}

export function markSessionUsed(session: TrackedSession): void {
  session.requestCount++;
}

export function markSessionCoolingDown(session: TrackedSession): void {
  session.coolingDown = true;
  session.cooldownUntil = Date.now() + COOLDOWN_MS;
}

export function getSessionsSnapshot(sessions: TrackedSession[]): Array<{
  label: string;
  requestCount: number;
  maxPerHour: number;
  softLimit: number;
  coolingDown: boolean;
  cooldownRemainingMs: number;
}> {
  const now = Date.now();
  return sessions.map((s) => ({
    label: s.label,
    requestCount: s.requestCount,
    maxPerHour: MAX_REQUESTS_PER_HOUR,
    softLimit: SOFT_LIMIT,
    coolingDown: s.coolingDown,
    cooldownRemainingMs: s.coolingDown ? Math.max(0, s.cooldownUntil - now) : 0,
  }));
}
