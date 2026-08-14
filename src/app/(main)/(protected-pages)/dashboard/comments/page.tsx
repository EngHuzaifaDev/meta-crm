"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  AlertCircle,
  Ban,
  Bug,
  CheckCircle,
  ChevronDown,
  ClipboardPaste,
  Download,
  Loader2,
  MessageSquare,
  Play,
  RefreshCw,
  Terminal,
  Users,
  WifiOff,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  exportFollowersCSVAction,
  exportFollowersCSVChunkAction,
  getHarvestLogsAction,
  pollBatchExtractionAction,
  type SerializedHarvestLogEntry,
  startCommentsExtractionAction,
  stopBatchExtractionAction,
} from "@/server/instagram/actions";
import type { ProgressEvent } from "@/server/instagram/streaming-extractor";

interface BatchTask {
  runId: string;
  profileUsername: string;
  status: string;
  batchId: string | null;
}

interface BatchRef {
  batchId: string;
}

const STORAGE_RUN = "commentsHarvestRun";

type PageState = "idle" | "restoring" | "running" | "completed" | "stopped" | "error";

function saveRunState(cookiesJson: string, urls: string, sourceUsername: string, testMode: boolean, refs: BatchRef[]) {
  sessionStorage.setItem(STORAGE_RUN, JSON.stringify({ cookiesJson, urls, sourceUsername, testMode, batchRefs: refs }));
}

export default function CommentsHarvestPage() {
  const [cookiesJson, setCookiesJson] = useState("");
  const [urls, setUrls] = useState("");
  const [sourceUsername, setSourceUsername] = useState("");
  const [testMode, setTestMode] = useState(false);
  const [pageState, setPageState] = useState<PageState>("idle");
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const [lastEvent, setLastEvent] = useState<ProgressEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [batchTasks, setBatchTasks] = useState<BatchTask[]>([]);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const [logs, setLogs] = useState<Record<string, SerializedHarvestLogEntry[]>>({});
  const [expandedLogs, setExpandedLogs] = useState<Record<string, boolean>>({});

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const batchRefsRef = useRef<BatchRef[]>([]);
  const batchRefs = batchRefsRef.current;

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
        const current = results.filter((s): s is NonNullable<typeof s> => !!s && s.status !== "not_found");
        if (current.length === 0) {
          clearPoll();
          setPageState("idle");
          sessionStorage.removeItem(STORAGE_RUN);
          return;
        }
        setEvents(current.flatMap((s) => s.progress as ProgressEvent[]));
        const tasks = current.flatMap((s) => s.tasks ?? []);
        setBatchTasks(tasks);

        const runIds = tasks.map((t) => t.runId).filter(Boolean);
        if (runIds.length > 0) {
          getHarvestLogsAction(runIds, 20)
            .then(setLogs)
            .catch(() => undefined);
        }

        const lasts = current.map((s) => s.lastEvent).filter(Boolean) as ProgressEvent[];
        if (lasts.length > 0) {
          const base = lasts[lasts.length - 1];
          setLastEvent({
            ...base,
            totalFollowers: lasts.reduce((n, e) => n + (e.totalFollowers ?? 0), 0),
            totalEstimatedFollowers: lasts.reduce((n, e) => n + (e.totalEstimatedFollowers ?? 0), 0),
            duplicateCount: lasts.reduce((n, e) => n + (e.duplicateCount ?? 0), 0),
          });
        }

        if (!current.some((s) => s.status === "running")) {
          clearPoll();
          sessionStorage.removeItem(STORAGE_RUN);
          batchRefsRef.current = [];
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

    let parsed: {
      cookiesJson?: string;
      urls?: string;
      sourceUsername?: string;
      testMode?: boolean;
      batchRefs?: BatchRef[];
    };
    try {
      parsed = JSON.parse(saved);
    } catch {
      sessionStorage.removeItem(STORAGE_RUN);
      return;
    }

    if (parsed.cookiesJson) setCookiesJson(parsed.cookiesJson);
    if (parsed.urls) setUrls(parsed.urls);
    if (parsed.sourceUsername) setSourceUsername(parsed.sourceUsername);
    if (typeof parsed.testMode === "boolean") setTestMode(parsed.testMode);

    const refs = (parsed.batchRefs ?? []).filter((r) => !!r && !!r.batchId);
    if (refs.length === 0) {
      sessionStorage.removeItem(STORAGE_RUN);
      return;
    }
    batchRefsRef.current = refs;

    setPageState("restoring");
    let cancelled = false;

    void (async () => {
      const results = await Promise.all(batchRefsRef.current.map((r) => pollBatchExtractionAction(r.batchId)));
      if (cancelled) return;

      const current = results.filter((s): s is NonNullable<typeof s> => !!s && s.status !== "not_found");
      if (current.length === 0) {
        setRestoreFailed(true);
        sessionStorage.removeItem(STORAGE_RUN);
        setTimeout(() => {
          if (!cancelled) setPageState("idle");
        }, 3000);
        return;
      }

      setEvents(current.flatMap((s) => s.progress as ProgressEvent[]));
      const tasks = current.flatMap((s) => s.tasks ?? []);
      setBatchTasks(tasks);
      const runIds = tasks.map((t) => t.runId).filter(Boolean);
      if (runIds.length > 0) {
        getHarvestLogsAction(runIds, 20)
          .then(setLogs)
          .catch(() => undefined);
      }
      const lasts = current.map((s) => s.lastEvent).filter(Boolean) as ProgressEvent[];
      if (lasts.length > 0) {
        setLastEvent({
          ...lasts[lasts.length - 1],
          totalFollowers: lasts.reduce((n, e) => n + (e.totalFollowers ?? 0), 0),
          totalEstimatedFollowers: lasts.reduce((n, e) => n + (e.totalEstimatedFollowers ?? 0), 0),
          duplicateCount: lasts.reduce((n, e) => n + (e.duplicateCount ?? 0), 0),
        });
      }

      if (current.some((s) => s.status === "running")) {
        setPageState("running");
        startPolling();
      } else {
        sessionStorage.removeItem(STORAGE_RUN);
        batchRefsRef.current = [];
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

    let validationError: string | undefined;
    if (!cookiesJson.trim()) {
      validationError = "Paste your Instagram cookies JSON first";
    } else {
      try {
        const parsed = JSON.parse(cookiesJson.trim());
        if (!Array.isArray(parsed)) throw new Error();
      } catch {
        validationError = "Invalid JSON — must be an array of cookie objects";
      }
    }
    if (!validationError && !urls.trim()) {
      validationError = "Enter at least one post/reel URL or shortcode";
    }
    if (validationError) {
      setError(validationError);
      return;
    }

    setPageState("running");

    const result = await startCommentsExtractionAction(
      cookiesJson.trim(),
      urls
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
      sourceUsername.trim() || undefined,
      testMode ? 2 : undefined,
    );

    if ("error" in result) {
      setPageState("idle");
      setError(result.error as string);
      return;
    }

    batchRefsRef.current = [{ batchId: result.batchId }];
    saveRunState(cookiesJson, urls, sourceUsername, testMode, batchRefsRef.current);
    startPolling();
  };

  const handleStop = async () => {
    await Promise.all(batchRefsRef.current.map((r) => stopBatchExtractionAction(r.batchId)));
    sessionStorage.removeItem(STORAGE_RUN);
    batchRefsRef.current = [];
    setBatchTasks([]);
  };

  const handleReset = () => {
    clearPoll();
    setPageState("idle");
    setEvents([]);
    setLastEvent(null);
    setError(null);
    setRestoreFailed(false);
    setBatchTasks([]);
    setLogs({});
    setExpandedLogs({});
    batchRefsRef.current = [];
    sessionStorage.removeItem(STORAGE_RUN);
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
      a.download = `usernames-part-${page + 1}-of-${totalPages}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const done = lastEvent?.type === "done";
  const totalFollowers = lastEvent?.totalFollowers ?? 0;
  const totalEstimatedFollowers = lastEvent?.totalEstimatedFollowers ?? 0;
  const duplicateCount = lastEvent?.duplicateCount ?? 0;
  const totalCount = lastEvent?.totalCount ?? 0;
  const processedCount = lastEvent?.processedCount ?? 0;
  const profileProgress = totalCount > 0 ? Math.round((processedCount / totalCount) * 100) : 0;
  const followerProgress =
    totalEstimatedFollowers > 0 ? Math.round((totalFollowers / totalEstimatedFollowers) * 100) : 0;

  const active = pageState === "running" || pageState === "restoring";
  const showProgress = pageState !== "idle" || events.length > 0;

  return (
    <div className="space-y-6 p-6">
      {pageState === "restoring" && !restoreFailed && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex items-center gap-3 pt-6">
            <RefreshCw className="h-5 w-5 animate-spin text-primary" />
            <div>
              <p className="font-medium text-sm">Reconnecting to harvest session...</p>
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
                Your form inputs are saved — review and start again. Any commenters already harvested remain in the
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
            <MessageSquare className="h-5 w-5" />
            Comments Harvest
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cookies">
              Instagram Cookies JSON
              <span className="ml-2 text-muted-foreground text-xs">(paste from browser cookie editor)</span>
            </Label>
            <textarea
              id="cookies"
              className="flex min-h-[120px] w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              placeholder='[{"domain":".instagram.com","name":"csrftoken","value":"...", ...}]'
              value={cookiesJson}
              onChange={(e) => setCookiesJson(e.target.value)}
              disabled={active}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="urls">
              Post / Reel URLs or Shortcodes
              <span className="ml-2 text-muted-foreground text-xs">
                (one per line — every commenter becomes a lead)
              </span>
            </Label>
            <textarea
              id="urls"
              className="flex min-h-[120px] w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              placeholder={[
                "https://www.instagram.com/reel/CiAgAqMqCd/",
                "https://www.instagram.com/p/CiAgAqMqCd/",
                "CiAgAqMqCd",
              ].join("\n")}
              value={urls}
              onChange={(e) => setUrls(e.target.value)}
              disabled={active}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="source">
              Source Account (optional)
              <span className="ml-2 text-muted-foreground text-xs">
                username the commenters are stored under (defaults to post owner)
              </span>
            </Label>
            <Input
              id="source"
              placeholder="e.g. natgeo"
              value={sourceUsername}
              onChange={(e) => setSourceUsername(e.target.value.replace(/^@/, ""))}
              disabled={active}
            />
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="test-mode"
              checked={testMode}
              onCheckedChange={(v) => setTestMode(v === true)}
              disabled={active}
            />
            <Label htmlFor="test-mode" className="flex cursor-pointer items-center gap-1.5">
              <Bug className="h-3.5 w-3.5" />
              Test mode — 2 pages per post
            </Label>
          </div>

          {error && <p className="text-destructive text-sm">{error}</p>}

          <div className="flex gap-2">
            {pageState === "idle" && (
              <Button onClick={startExtraction}>
                <Play className="mr-2 h-4 w-4" />
                {testMode ? "Run Test" : "Start Harvest"}
              </Button>
            )}
            {active && (
              <>
                <Button disabled>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {pageState === "restoring" ? "Reconnecting..." : "Harvesting..."}
                </Button>
                <Button variant="destructive" onClick={handleStop} disabled={pageState === "restoring"}>
                  <Ban className="mr-2 h-4 w-4" />
                  Stop
                </Button>
              </>
            )}
            {(pageState === "completed" || pageState === "stopped" || pageState === "error") && (
              <>
                <Button variant="outline" onClick={handleReset}>
                  <Play className="mr-2 h-4 w-4" />
                  Start New Harvest
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
              {pageState === "running" && "Harvest Progress"}
              {pageState === "completed" && "Harvest Complete"}
              {pageState === "stopped" && "Harvest Stopped"}
              {pageState === "error" && "Harvest Failed"}
              {pageState === "idle" && "Progress"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {(pageState === "running" || pageState === "restoring") && totalCount > 0 && (
              <div className="space-y-3">
                <div>
                  <div className="mb-1 flex justify-between text-muted-foreground text-xs">
                    <span>
                      {processedCount} of {totalCount} posts
                    </span>
                    <span>{profileProgress}%</span>
                  </div>
                  <Progress value={profileProgress} className="h-2" />
                </div>
                {totalEstimatedFollowers > 0 && (
                  <div>
                    <div className="mb-1 flex justify-between text-muted-foreground text-xs">
                      <span>
                        {totalFollowers.toLocaleString()} of ~{totalEstimatedFollowers.toLocaleString()} commenters
                      </span>
                      <span>{followerProgress}%</span>
                    </div>
                    <Progress value={followerProgress} className="h-1.5" />
                  </div>
                )}
              </div>
            )}

            {batchRefs.length > 0 && (
              <div className="space-y-1.5">
                <p className="font-medium text-muted-foreground text-xs">
                  Posts — {batchTasks.length} item{batchTasks.length !== 1 ? "s" : ""}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {batchTasks.map((t) => (
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
                      {t.status === "stopped" && <Ban className="h-3 w-3" />}
                      {t.profileUsername}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 text-sm">
              {pageState === "running" && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
              {pageState === "restoring" && <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />}
              {pageState === "stopped" && <Ban className="h-4 w-4 text-orange-500" />}
              {pageState === "error" && <AlertCircle className="h-4 w-4 text-destructive" />}
              {pageState === "completed" && <CheckCircle className="h-4 w-4 text-green-500" />}
              <span>
                {lastEvent?.profileUsername ? <span className="font-medium">{lastEvent.profileUsername}</span> : null}{" "}
                {pageState === "restoring" ? "Restoring previous session state..." : (lastEvent?.message ?? "")}
                {pageState === "completed" && !lastEvent?.message && "All posts processed"}
                {pageState === "stopped" && !lastEvent?.message && "Harvest was stopped by user"}
                {pageState === "error" && !lastEvent?.message && "Harvest encountered an error"}
              </span>
            </div>

            <div className="flex flex-wrap gap-3">
              <Badge variant="secondary" className="gap-1 text-sm">
                <Users className="h-3.5 w-3.5" />
                {totalFollowers.toLocaleString()} commenters
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

      {/* ---- Debug Logs ---- */}
      {Object.keys(logs).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Terminal className="h-5 w-5" />
              Debug Logs
              <Badge variant="secondary" className="ml-2">
                {Object.values(logs).reduce((n, entries) => n + entries.length, 0)} requests
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {Object.entries(logs).map(([runId, entries]) => {
              const shortcode = batchTasks.find((t) => t.runId === runId)?.profileUsername ?? runId.slice(0, 8);
              const reversed = [...entries].reverse();
              return (
                <div key={runId} className="space-y-1.5">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
                    onClick={() => setExpandedLogs((prev) => ({ ...prev, [runId]: !prev[runId] }))}
                  >
                    <ChevronDown
                      className={`h-4 w-4 transition-transform ${expandedLogs[runId] ? "" : "-rotate-90"}`}
                    />
                    <span className="font-medium font-mono">{shortcode}</span>
                    <span className="text-muted-foreground text-xs">
                      {entries.length} entries — latest {new Date(entries[entries.length - 1].ts).toLocaleTimeString()}
                    </span>
                  </button>
                  {expandedLogs[runId] && (
                    <div className="space-y-1.5">
                      {reversed.slice(0, 25).map((e, i) => (
                        <LogRow key={`${runId}-${e.ts}-${i}`} entry={e} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function LogRow({ entry }: { entry: SerializedHarvestLogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const error = !!entry.error || (entry.status !== null && entry.status >= 400);
  const summary = [
    entry.kind,
    entry.status !== null ? `HTTP ${entry.status}` : null,
    entry.error,
    entry.commentersCount !== null ? `${entry.commentersCount} commenters` : null,
    entry.nextMaxId ? `next=${entry.nextMaxId.slice(0, 12)}…` : null,
    entry.durationMs !== null ? `${entry.durationMs}ms` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className={`rounded-md border px-3 py-2 text-xs ${error ? "border-destructive/40 bg-destructive/5" : ""}`}>
      <button type="button" className="w-full text-left font-mono" onClick={() => setExpanded((v) => !v)}>
        <span className="text-muted-foreground">{new Date(entry.ts).toLocaleTimeString()}</span> {summary}
      </button>
      {expanded && (
        <div className="mt-2 space-y-1.5">
          {entry.url && (
            <pre className="overflow-x-auto rounded bg-muted p-2 text-[11px]">
              {entry.url}
              {entry.params && Object.keys(entry.params).length > 0 ? `\n${JSON.stringify(entry.params, null, 2)}` : ""}
            </pre>
          )}
          {entry.body && (
            <pre className="max-h-60 overflow-auto rounded bg-muted p-2 text-[11px]">
              {entry.body.length > 4000 ? `${entry.body.slice(0, 4000)}\n…[truncated]` : entry.body}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
