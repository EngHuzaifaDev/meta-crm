import type { ProgressEvent } from "./streaming-extractor";
import { randomUUID } from "node:crypto";

const MAX_EVENTS = 1000;

interface RunState {
  status: "running" | "done" | "error" | "stopped";
  progress: ProgressEvent[];
  lastEvent: ProgressEvent | null;
}

const runs = new Map<string, RunState>();

export function createRun(): string {
  const id = randomUUID();
  runs.set(id, { status: "running", progress: [], lastEvent: null });
  return id;
}

export function pushEvent(runId: string, event: ProgressEvent): void {
  const run = runs.get(runId);
  if (!run) return;
  run.progress.push(event);
  if (run.progress.length > MAX_EVENTS) {
    run.progress.splice(0, run.progress.length - MAX_EVENTS);
  }
  run.lastEvent = event;
  if (event.type === "done") run.status = "done";
  if (event.type === "error") run.status = "error";
}

export function getRunState(runId: string, maxEvents = 50): RunState | null {
  const run = runs.get(runId) ?? null;
  if (!run) return null;
  return {
    status: run.status,
    progress: run.progress.slice(-maxEvents),
    lastEvent: run.lastEvent,
  };
}

export function markStopped(runId: string): void {
  const run = runs.get(runId);
  if (run) run.status = "stopped";
}

export function clearRun(runId: string): void {
  runs.delete(runId);
}
