import type { ProgressEvent } from "./streaming-extractor";
import { randomUUID } from "node:crypto";

interface RunState {
  status: "running" | "done" | "error" | "stopped";
  progress: ProgressEvent[];
  lastEvent: ProgressEvent | null;
}

const runs = new Map<string, RunState>();
const abortControllers = new Map<string, AbortController>();

export function createRun(): string {
  const id = randomUUID();
  runs.set(id, { status: "running", progress: [], lastEvent: null });
  abortControllers.set(id, new AbortController());
  return id;
}

export function pushEvent(runId: string, event: ProgressEvent): void {
  const run = runs.get(runId);
  if (!run) return;
  run.progress.push(event);
  run.lastEvent = event;
  if (event.type === "done") run.status = "done";
  if (event.type === "error") run.status = "error";
}

export function getRunState(runId: string): RunState | null {
  return runs.get(runId) ?? null;
}

export function getAbortSignal(runId: string): AbortSignal | null {
  return abortControllers.get(runId)?.signal ?? null;
}

export function abortRun(runId: string): void {
  const ctrl = abortControllers.get(runId);
  if (ctrl) {
    ctrl.abort();
    abortControllers.delete(runId);
  }
  const run = runs.get(runId);
  if (run) run.status = "stopped";
}

export function markStopped(runId: string): void {
  abortRun(runId);
}

export function clearRun(runId: string): void {
  abortControllers.delete(runId);
  runs.delete(runId);
}
