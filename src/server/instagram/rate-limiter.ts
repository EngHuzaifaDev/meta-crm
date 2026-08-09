const RATE_LIMIT_PER_MIN = 2000;
const REFILL_INTERVAL_MS = 1000;
const TOKENS_PER_REFILL = Math.ceil(RATE_LIMIT_PER_MIN / (60000 / REFILL_INTERVAL_MS));

let tokens = RATE_LIMIT_PER_MIN;
let lastRefill = Date.now();
const waiting: Array<() => void> = [];

function refill() {
  const now = Date.now();
  const elapsed = now - lastRefill;
  const refillCount = Math.floor(elapsed / REFILL_INTERVAL_MS);
  if (refillCount > 0) {
    tokens = Math.min(RATE_LIMIT_PER_MIN, tokens + refillCount * TOKENS_PER_REFILL);
    lastRefill = now;
  }
  while (waiting.length > 0 && tokens > 0) {
    tokens--;
    const resolve = waiting.shift();
    if (resolve) resolve();
  }
}

export function acquireToken(): Promise<void> {
  return new Promise((resolve) => {
    refill();
    if (tokens > 0) {
      tokens--;
      resolve();
    } else {
      waiting.push(resolve);
    }
  });
}

setInterval(refill, REFILL_INTERVAL_MS).unref();
