"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  AlertCircle,
  Ban,
  Bug,
  CheckCircle,
  ClipboardPaste,
  Download,
  Info,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Terminal,
  Users,
  WifiOff,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  exportFollowersCSVAction,
  exportFollowersCSVChunkAction,
  getScrapedSourcesAction,
  pollBatchExtractionAction,
  startCookieExtractionAction,
  stopBatchExtractionAction,
} from "@/server/instagram/actions";
import type { ProgressEvent } from "@/server/instagram/streaming-extractor";

interface ScrapedSource {
  profileUsername: string;
  followerCount: number;
  profilePicUrl?: string;
  isPrivate?: boolean;
  isInvalid?: boolean;
}

interface BatchTask {
  runId: string;
  profileUsername: string;
  status: string;
  batchId: string | null;
}

interface ExtractionJob {
  id: string;
  cookiesJson: string;
  usernames: string;
  error?: string;
}

interface BatchRef {
  jobId: string;
  batchId: string;
}

const STORAGE_RUN = "cookieExtractionRun";
const MAX_JOBS = 5;

type PageState = "idle" | "restoring" | "running" | "completed" | "stopped" | "error";

function saveRunState(jobs: ExtractionJob[], testMode: boolean, batchRefs: BatchRef[]) {
  sessionStorage.setItem(STORAGE_RUN, JSON.stringify({ jobs, testMode, batchRefs }));
}

function newJob(): ExtractionJob {
  return { id: crypto.randomUUID(), cookiesJson: "", usernames: "" };
}

function jobUsernames(job: ExtractionJob): string[] {
  return job.usernames
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function CookieExtractionPage() {
  const [jobs, setJobs] = useState<ExtractionJob[]>(() => [newJob()]);
  const [testMode, setTestMode] = useState(false);
  const [pageState, setPageState] = useState<PageState>("idle");
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const [lastEvent, setLastEvent] = useState<ProgressEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showStopModal, setShowStopModal] = useState(false);
  const [showIssuesModal, setShowIssuesModal] = useState(false);
  const [scrapedSources, setScrapedSources] = useState<ScrapedSource[]>([]);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const [batchTasks, setBatchTasks] = useState<BatchTask[]>([]);
  const [batchRefs, setBatchRefs] = useState<BatchRef[]>([]);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const batchRefsRef = useRef<BatchRef[]>([]);

  useEffect(() => {
    getScrapedSourcesAction(50)
      .then((res) => setScrapedSources(res.sources))
      .catch(() => {});
  }, []);

  const clearPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      const refs = batchRefsRef.current;
      if (refs.length === 0) {
        clearPoll();
        setPageState("idle");
        sessionStorage.removeItem(STORAGE_RUN);
        return;
      }
      try {
        const results = await Promise.all(refs.map((r) => pollBatchExtractionAction(r.batchId)));
        const alive = refs.filter((_, i) => results[i] && results[i].status !== "not_found");
        if (alive.length !== refs.length) {
          batchRefsRef.current = alive;
          setBatchRefs(alive);
          if (alive.length === 0) {
            clearPoll();
            setPageState("idle");
            sessionStorage.removeItem(STORAGE_RUN);
            return;
          }
        }
        const current = results.filter((s): s is NonNullable<typeof s> => !!s && s.status !== "not_found");
        const allEvents = current.flatMap((s) => s.progress as ProgressEvent[]);
        setEvents(allEvents);
        setBatchTasks(current.flatMap((s) => s.tasks ?? []));

        const lasts = current.map((s) => s.lastEvent).filter(Boolean) as ProgressEvent[];
        if (lasts.length > 0) {
          let newestIdx = -1;
          let newest: ProgressEvent | null = null;
          let offset = 0;
          for (const s of current) {
            const idx = offset + (s.progress?.length ?? 0) - 1;
            if (idx >= 0 && s.lastEvent && idx > newestIdx) {
              newestIdx = idx;
              newest = s.lastEvent as ProgressEvent;
            }
            offset += s.progress?.length ?? 0;
          }
          const base = newest ?? lasts[0];
          setLastEvent({
            ...base,
            totalFollowers: lasts.reduce((n, e) => n + (e.totalFollowers ?? 0), 0),
            totalEstimatedFollowers: lasts.reduce((n, e) => n + (e.totalEstimatedFollowers ?? 0), 0),
            invalidCount: lasts.reduce((n, e) => n + (e.invalidCount ?? 0), 0),
            privateCount: lasts.reduce((n, e) => n + (e.privateCount ?? 0), 0),
            duplicateCount: lasts.reduce((n, e) => n + (e.duplicateCount ?? 0), 0),
            skippedCount: lasts.reduce((n, e) => n + (e.skippedCount ?? 0), 0),
            processedCount: lasts.reduce((n, e) => n + (e.processedCount ?? 0), 0),
            totalCount: lasts.reduce((n, e) => n + (e.totalCount ?? 0), 0),
          });
        }

        if (!current.some((s) => s.status === "running")) {
          clearPoll();
          sessionStorage.removeItem(STORAGE_RUN);
          batchRefsRef.current = [];
          setBatchRefs([]);
          if (current.some((s) => s.status === "error")) setPageState("error");
          else if (current.some((s) => s.status === "stopped")) setPageState("stopped");
          else setPageState("completed");
        }
      } catch (err) {
        console.error("Poll error:", err);
      }
    }, 5000);
  }, [clearPoll]);

  useEffect(() => {
    const saved = sessionStorage.getItem(STORAGE_RUN);
    if (!saved) return;

    let parsed: { jobs?: ExtractionJob[]; testMode?: boolean; batchRefs?: BatchRef[] };
    try {
      parsed = JSON.parse(saved);
    } catch {
      sessionStorage.removeItem(STORAGE_RUN);
      return;
    }

    if (parsed.jobs?.length) setJobs(parsed.jobs);
    if (typeof parsed.testMode === "boolean") setTestMode(parsed.testMode);

    const refs = (parsed.batchRefs ?? []).filter((r) => !!r && !!r.batchId);
    if (refs.length === 0) return;

    const savedJobs = parsed.jobs ?? [];
    const savedTestMode = parsed.testMode ?? false;

    setPageState("restoring");
    let cancelled = false;

    void (async () => {
      const results = await Promise.all(refs.map((r) => pollBatchExtractionAction(r.batchId)));
      if (cancelled) return;

      const alive = refs.filter((_, i) => results[i] && results[i].status !== "not_found");
      if (alive.length === 0) {
        setRestoreFailed(true);
        sessionStorage.removeItem(STORAGE_RUN);
        setTimeout(() => {
          if (!cancelled) setPageState("idle");
        }, 3000);
        return;
      }

      batchRefsRef.current = alive;
      setBatchRefs(alive);
      const current = results.filter((s): s is NonNullable<typeof s> => !!s && s.status !== "not_found");
      setEvents(current.flatMap((s) => s.progress as ProgressEvent[]));
      setBatchTasks(current.flatMap((s) => s.tasks ?? []));

      if (current.some((s) => s.status === "running")) {
        saveRunState(savedJobs, savedTestMode, alive);
        setPageState("running");
        startPolling();
      } else {
        sessionStorage.removeItem(STORAGE_RUN);
        batchRefsRef.current = [];
        setBatchRefs([]);
        const lastEventOf = (s: NonNullable<(typeof current)[number]>): ProgressEvent | null =>
          s.lastEvent as ProgressEvent | null;
        const lastEvents = current.map(lastEventOf).filter(Boolean) as ProgressEvent[];
        if (lastEvents.length > 0) {
          setLastEvent({
            ...lastEvents[lastEvents.length - 1],
            totalFollowers: lastEvents.reduce((n, e) => n + (e.totalFollowers ?? 0), 0),
            totalEstimatedFollowers: lastEvents.reduce((n, e) => n + (e.totalEstimatedFollowers ?? 0), 0),
            invalidCount: lastEvents.reduce((n, e) => n + (e.invalidCount ?? 0), 0),
            privateCount: lastEvents.reduce((n, e) => n + (e.privateCount ?? 0), 0),
            duplicateCount: lastEvents.reduce((n, e) => n + (e.duplicateCount ?? 0), 0),
            skippedCount: lastEvents.reduce((n, e) => n + (e.skippedCount ?? 0), 0),
            processedCount: lastEvents.reduce((n, e) => n + (e.processedCount ?? 0), 0),
            totalCount: lastEvents.reduce((n, e) => n + (e.totalCount ?? 0), 0),
          });
        }
        if (current.some((s) => s.status === "error")) setPageState("error");
        else if (current.some((s) => s.status === "stopped")) setPageState("stopped");
        else setPageState("completed");
      }
    })();

    return () => {
      cancelled = true;
      clearPoll();
    };
  }, [clearPoll, startPolling]);

  const startExtraction = async () => {
    setError(null);
    setEvents([]);
    setLastEvent(null);
    setRestoreFailed(false);
    setBatchTasks([]);

    const validated = jobs.map((job) => {
      let jobError: string | undefined;
      if (!job.cookiesJson.trim()) {
        jobError = "Paste your Instagram cookies JSON first";
      } else {
        try {
          const parsed = JSON.parse(job.cookiesJson.trim());
          if (!Array.isArray(parsed)) throw new Error();
        } catch {
          jobError = "Invalid JSON — must be an array of cookie objects";
        }
      }
      if (!jobError && jobUsernames(job).length === 0) {
        jobError = "Enter at least one username";
      }
      return { ...job, error: jobError };
    });
    setJobs(validated);

    if (validated.every((j) => j.error)) return;

    setPageState("running");

    const validJobs = validated.filter((j) => !j.error);
    const results = await Promise.all(
      validJobs.map(async (job) => {
        const result = await startCookieExtractionAction(
          job.cookiesJson.trim(),
          jobUsernames(job),
          testMode ? 2 : undefined,
        );
        if ("error" in result) return { jobId: job.id, error: result.error as string };
        return { jobId: job.id, batchId: result.batchId };
      }),
    );

    const failed = results.filter((r) => "error" in r) as { jobId: string; error: string }[];
    if (failed.length > 0) {
      setJobs((prev) =>
        prev.map((job) => {
          const res = failed.find((r) => r.jobId === job.id);
          return res ? { ...job, error: res.error } : job;
        }),
      );
    }

    const ok = results.filter((r) => "batchId" in r) as BatchRef[];
    if (ok.length === 0) {
      setPageState("idle");
      setError("No extractions could be started — fix the highlighted errors");
      return;
    }

    batchRefsRef.current = ok;
    setBatchRefs(ok);
    saveRunState(validated, testMode, ok);
    startPolling();
  };

  const handleStop = async () => {
    await Promise.all(batchRefsRef.current.map((r) => stopBatchExtractionAction(r.batchId)));
    sessionStorage.removeItem(STORAGE_RUN);
    batchRefsRef.current = [];
    setBatchRefs([]);
    setShowStopModal(false);
  };

  const handleExportCSV = async () => {
    const { total } = await exportFollowersCSVAction();
    const chunkSize = 50000;
    const totalPages = Math.ceil(total / chunkSize);
    for (let page = 0; page < totalPages; page++) {
      const { csv } = await exportFollowersCSVChunkAction(undefined, page, chunkSize);
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `followers-part-${page + 1}-of-${totalPages}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const handleExtractSource = (username: string) => {
    setJobs((prev) => {
      const [first, ...rest] = prev;
      const lines = jobUsernames(first);
      if (lines.includes(username)) return prev;
      return [{ ...first, usernames: [...lines, username].join("\n") }, ...rest];
    });
  };

  const updateJob = (id: string, patch: Partial<ExtractionJob>) => {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)));
  };

  const addJob = () => {
    setJobs((prev) => (prev.length >= MAX_JOBS ? prev : [...prev, newJob()]));
  };

  const removeJob = (id: string) => {
    setJobs((prev) => (prev.length > 1 ? prev.filter((j) => j.id !== id) : prev));
  };

  const handleReset = () => {
    clearPoll();
    setPageState("idle");
    setEvents([]);
    setLastEvent(null);
    setError(null);
    setRestoreFailed(false);
    setShowIssuesModal(false);
    setBatchTasks([]);
    sessionStorage.removeItem(STORAGE_RUN);
    batchRefsRef.current = [];
    setBatchRefs([]);
  };

  const done = lastEvent?.type === "done";
  const totalFollowers = lastEvent?.totalFollowers ?? 0;
  const totalEstimatedFollowers = lastEvent?.totalEstimatedFollowers ?? 0;
  const invalidCount = lastEvent?.invalidCount ?? 0;
  const privateCount = lastEvent?.privateCount ?? 0;
  const duplicateCount = lastEvent?.duplicateCount ?? 0;
  const knownIssues = events.filter((e) => e.kind === "known").length;
  const unexpectedErrors = events.filter((e) => e.kind === "unknown").length;
  const processedCount = lastEvent?.processedCount ?? 0;
  const totalCount = lastEvent?.totalCount ?? 0;
  const profileProgress = totalCount > 0 ? Math.round((processedCount / totalCount) * 100) : 0;
  const followerProgress =
    totalEstimatedFollowers > 0 ? Math.round((totalFollowers / totalEstimatedFollowers) * 100) : 0;

  const active = pageState === "running" || pageState === "restoring";
  const showProgress = pageState !== "idle" || events.length > 0;

  useEffect(() => {
    if (
      (pageState === "completed" || pageState === "stopped" || pageState === "error") &&
      (knownIssues > 0 || unexpectedErrors > 0)
    ) {
      setShowIssuesModal(true);
    }
  }, [pageState, knownIssues, unexpectedErrors]);

  return (
    <div className="space-y-6 p-6">
      {pageState === "restoring" && !restoreFailed && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex items-center gap-3 pt-6">
            <RefreshCw className="h-5 w-5 animate-spin text-primary" />
            <div>
              <p className="font-medium text-sm">Reconnecting to extraction session...</p>
              <p className="mt-0.5 text-muted-foreground text-xs">
                Verifying server state — you will not lose progress
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {pageState === "restoring" && restoreFailed && (
        <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
          <CardContent className="flex items-center gap-3 pt-6">
            <WifiOff className="h-5 w-5 text-amber-600" />
            <div>
              <p className="font-medium text-amber-800 text-sm dark:text-amber-300">
                Previous session was lost (server restarted)
              </p>
              <p className="mt-0.5 text-amber-600 text-xs dark:text-amber-400">
                Your form inputs are saved — review and start again. Any followers already scraped remain in the
                database.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---- Form ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Terminal className="h-5 w-5" />
            Cookie-Based Extraction
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {jobs.map((job, index) => (
            <div key={job.id} className="relative space-y-4 rounded-lg border p-4">
              {jobs.length > 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="absolute top-2 right-2"
                  onClick={() => removeJob(job.id)}
                  disabled={active}
                >
                  <X className="mr-1 h-4 w-4" />
                  Remove
                </Button>
              )}
              <p className="flex items-center gap-2 font-medium text-sm">
                <Users className="h-4 w-4 text-muted-foreground" />
                Extraction {index + 1}
              </p>
              <div className="space-y-2">
                <Label htmlFor={`cookies-${job.id}`}>
                  Instagram Cookies JSON
                  <span className="ml-2 text-muted-foreground text-xs">(paste from browser cookie editor)</span>
                </Label>
                <textarea
                  id={`cookies-${job.id}`}
                  className="flex min-h-[180px] w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  placeholder='[{"domain":".instagram.com","name":"csrftoken","value":"...", ...}]'
                  value={job.cookiesJson}
                  onChange={(e) => updateJob(job.id, { cookiesJson: e.target.value, error: undefined })}
                  disabled={active}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor={`usernames-${job.id}`}>
                  Target Usernames
                  <span className="ml-2 text-muted-foreground text-xs">(one per line)</span>
                </Label>
                <textarea
                  id={`usernames-${job.id}`}
                  className="flex min-h-[100px] w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  placeholder={["target_user1", "target_user2"].join("\n")}
                  value={job.usernames}
                  onChange={(e) => updateJob(job.id, { usernames: e.target.value, error: undefined })}
                  disabled={active}
                />
              </div>

              {job.error && <p className="text-destructive text-sm">{job.error}</p>}
            </div>
          ))}

          {jobs.length < MAX_JOBS && (
            <Button variant="outline" onClick={addJob} disabled={active}>
              <Plus className="mr-2 h-4 w-4" />
              Add extraction
            </Button>
          )}

          {scrapedSources.length > 0 && (
            <div className="space-y-1.5">
              <p className="font-medium text-muted-foreground text-xs">Previously extracted — click to add</p>
              <div className="flex flex-wrap gap-1.5">
                {scrapedSources.map((s) => (
                  <button
                    key={s.profileUsername}
                    type="button"
                    disabled={active || s.isPrivate || s.isInvalid}
                    onClick={() => handleExtractSource(s.profileUsername)}
                    className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs transition-colors hover:bg-muted disabled:opacity-40"
                  >
                    @{s.profileUsername}
                    <span className="text-muted-foreground">({s.followerCount})</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Checkbox
              id="test-mode"
              checked={testMode}
              onCheckedChange={(v) => setTestMode(v === true)}
              disabled={active}
            />
            <Label htmlFor="test-mode" className="flex cursor-pointer items-center gap-1.5">
              <Bug className="h-3.5 w-3.5" />
              Test mode — 2 pages per profile
            </Label>
          </div>

          {error && <p className="text-destructive text-sm">{error}</p>}

          <div className="flex gap-2">
            {pageState === "idle" && (
              <Button onClick={startExtraction}>
                <Play className="mr-2 h-4 w-4" />
                {testMode
                  ? "Run Test"
                  : `Start ${jobs.length > 1 ? `${jobs.length} ` : ""}Extraction${jobs.length > 1 ? "s" : ""}`}
              </Button>
            )}
            {active && (
              <>
                <Button disabled>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {pageState === "restoring" ? "Reconnecting..." : "Extracting..."}
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => setShowStopModal(true)}
                  disabled={pageState === "restoring"}
                >
                  <Ban className="mr-2 h-4 w-4" />
                  Stop
                </Button>
              </>
            )}
            {(pageState === "completed" || pageState === "stopped" || pageState === "error") && (
              <>
                <Button variant="outline" onClick={handleReset}>
                  <Play className="mr-2 h-4 w-4" />
                  Start New Extraction
                </Button>
                {totalFollowers > 0 && (
                  <Button variant="outline" onClick={handleExportCSV}>
                    <Download className="mr-2 h-4 w-4" />
                    Export CSV ({totalFollowers})
                  </Button>
                )}
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ---- Progress ---- */}
      {showProgress && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {pageState === "running" || pageState === "restoring" ? (
                <RefreshCw
                  className={`h-5 w-5 ${pageState === "running" ? "animate-spin text-primary" : "text-muted-foreground"}`}
                />
              ) : (
                <ClipboardPaste className="h-5 w-5" />
              )}
              {pageState === "restoring" && "Reconnecting..."}
              {pageState === "running" && "Extraction Progress"}
              {pageState === "completed" && "Extraction Complete"}
              {pageState === "stopped" && "Extraction Stopped"}
              {pageState === "error" && "Extraction Failed"}
              {pageState === "idle" && "Progress"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {(pageState === "running" || pageState === "restoring") && totalCount > 0 && (
              <div className="space-y-3">
                <div>
                  <div className="mb-1 flex justify-between text-muted-foreground text-xs">
                    <span>
                      {processedCount} of {totalCount} profiles
                    </span>
                    <span>{profileProgress}%</span>
                  </div>
                  <Progress value={profileProgress} className="h-2" />
                </div>
                {totalEstimatedFollowers > 0 && (
                  <div>
                    <div className="mb-1 flex justify-between text-muted-foreground text-xs">
                      <span>
                        {totalFollowers.toLocaleString()} of ~{totalEstimatedFollowers.toLocaleString()} followers
                      </span>
                      <span>{followerProgress}%</span>
                    </div>
                    <Progress value={followerProgress} className="h-1.5" />
                  </div>
                )}
              </div>
            )}

            {batchRefs.map((ref, i) => {
              const tasks = batchTasks.filter((t) => t.batchId === ref.batchId);
              if (tasks.length === 0) return null;
              return (
                <div key={ref.batchId} className="space-y-1.5">
                  <p className="font-medium text-muted-foreground text-xs">
                    Extraction {i + 1} — {tasks.length} profile{tasks.length !== 1 ? "s" : ""}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {tasks.map((t) => (
                      <Badge
                        key={t.runId}
                        variant={
                          t.status === "done"
                            ? "default"
                            : t.status === "failed" || t.status === "stopped"
                              ? "destructive"
                              : "secondary"
                        }
                        className={t.status === "pending" || t.status === "running" ? "gap-1" : "gap-1 opacity-70"}
                      >
                        {t.status === "running" && <Loader2 className="h-3 w-3 animate-spin" />}
                        {t.status === "pending" && <RefreshCw className="h-3 w-3" />}
                        {t.status === "done" && <CheckCircle className="h-3 w-3" />}
                        {t.status === "failed" && <AlertCircle className="h-3 w-3" />}
                        {t.status === "stopped" && <Ban className="h-3 w-3" />}@{t.profileUsername}
                      </Badge>
                    ))}
                  </div>
                </div>
              );
            })}

            <div className="flex items-center gap-2 text-sm">
              {pageState === "running" && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
              {pageState === "restoring" && <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />}
              {pageState === "stopped" && <Ban className="h-4 w-4 text-orange-500" />}
              {pageState === "error" && <AlertCircle className="h-4 w-4 text-destructive" />}
              {pageState === "completed" && <CheckCircle className="h-4 w-4 text-green-500" />}
              <span>
                {lastEvent?.profileUsername ? <span className="font-medium">@{lastEvent.profileUsername}</span> : null}{" "}
                {pageState === "restoring" ? "Restoring previous session state..." : (lastEvent?.message ?? "")}
                {pageState === "completed" && !lastEvent?.message && "All profiles processed"}
                {pageState === "stopped" && !lastEvent?.message && "Extraction was stopped by user"}
                {pageState === "error" && !lastEvent?.message && "Extraction encountered an error"}
              </span>
            </div>

            <div className="flex flex-wrap gap-3">
              <Badge variant="secondary" className="gap-1 text-sm">
                <Users className="h-3.5 w-3.5" />
                {totalFollowers} followers
              </Badge>
              <Badge variant="outline" className="gap-1 border-amber-300 text-amber-600 text-sm">
                <AlertCircle className="h-3.5 w-3.5" />
                {invalidCount} invalid
              </Badge>
              <Badge variant="outline" className="gap-1 border-violet-300 text-sm text-violet-600">
                {privateCount} private
              </Badge>
              <Badge variant="outline" className="gap-1 text-muted-foreground text-sm">
                {duplicateCount} duplicates
              </Badge>
              {done && (
                <Badge className="gap-1 bg-green-600 text-sm">
                  <CheckCircle className="h-3.5 w-3.5" />
                  Complete
                </Badge>
              )}
            </div>

            {pageState === "running" && (
              <p className="flex items-center gap-1 text-muted-foreground text-xs">
                <RefreshCw className="h-3 w-3 animate-spin" />
                Auto-refreshing every 5 seconds
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Issues Modal */}
      {showIssuesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="mx-4 w-full max-w-md">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Info className="h-5 w-5 text-sky-500" />
                Extraction finished with issues
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-muted-foreground text-sm">
                {totalFollowers} followers scraped, but some profiles could not be processed.
              </p>
              {knownIssues > 0 && (
                <div className="space-y-1 rounded-md border border-sky-300/50 bg-sky-50 p-3 dark:bg-sky-950/20">
                  <p className="flex items-center gap-2 font-medium text-sky-700 text-sm dark:text-sky-300">
                    <Info className="h-4 w-4" />
                    {knownIssues} profile{knownIssues !== 1 ? "s" : ""} skipped — known Instagram-side issue
                  </p>
                  <p className="text-sky-600 text-xs dark:text-sky-400">
                    Instagram removed the profile-info schema for business/creator accounts. This is a known change on
                    Instagram's side, not a failure of the extraction — other profiles were unaffected. Retry these
                    later with fresh cookies.
                  </p>
                </div>
              )}
              {unexpectedErrors > 0 && (
                <div className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3">
                  <p className="flex items-center gap-2 font-medium text-destructive text-sm">
                    <AlertCircle className="h-4 w-4" />
                    {unexpectedErrors} unexpected error{unexpectedErrors !== 1 ? "s" : ""}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    These are not explained by known Instagram behavior. Likely causes: expired session, proxy/IP
                    flagged, or a rate limit. Check the logs and re-run with fresh cookies.
                  </p>
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowIssuesModal(false)}>
                  Got it
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Stop Confirmation Modal */}
      {showStopModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="mx-4 w-full max-w-sm">
            <CardHeader>
              <CardTitle className="text-lg">Stop Extraction?</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-muted-foreground text-sm">
                The current page will finish, then extraction stops. Any followers already scraped remain saved.
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowStopModal(false)}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={handleStop}>
                  Stop
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
