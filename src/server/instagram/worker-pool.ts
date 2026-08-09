import { claimNextPendingTask, completeTask, failTask } from "@/lib/db/utils/extraction-task";

let running = false;
let activeCount = 0;
const MAX_CONCURRENT = 5;
const POLL_INTERVAL_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function runTask(task: Awaited<ReturnType<typeof claimNextPendingTask>>): Promise<void> {
  if (!task) return;

  const { extractSingleProfileFromCookies } = await import("./streaming-extractor");
  const cookies = JSON.parse(task.cookies);

  try {
    await extractSingleProfileFromCookies({
      cookies,
      profileUsername: task.profileUsername,
      maxPages: task.maxPages,
      runId: task.runId,
    });
    await completeTask(task.runId);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    let errorType: "SESSION_EXPIRED" | "PROXY_FAILED" | "RATE_LIMITED" | "UNKNOWN" = "UNKNOWN";
    if (msg.includes("SESSION_EXPIRED")) errorType = "SESSION_EXPIRED";
    else if (msg.includes("PROXY_FAILED")) errorType = "PROXY_FAILED";
    else if (msg.includes("RATE_LIMITED")) errorType = "RATE_LIMITED";
    await failTask(task.runId, msg, errorType);
  } finally {
    activeCount--;
  }
}

async function pollLoop(): Promise<void> {
  while (running) {
    if (activeCount < MAX_CONCURRENT) {
      const task = await claimNextPendingTask();
      if (task) {
        activeCount++;
        void runTask(task);
      }
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

export function startWorkerLoop(): void {
  if (running) return;
  running = true;
  void pollLoop();
}

export function stopWorkerLoop(): void {
  running = false;
}
