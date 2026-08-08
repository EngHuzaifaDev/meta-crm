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
  RefreshCw,
  Terminal,
  Users,
  WifiOff,
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
  pollExtractionAction,
  startCookieExtractionAction,
  stopExtractionAction,
} from "@/server/instagram/actions";
import type { ProgressEvent } from "@/server/instagram/streaming-extractor";

interface ScrapedSource {
  profileUsername: string;
  followerCount: number;
  profilePicUrl?: string;
  isPrivate?: boolean;
  isInvalid?: boolean;
}

const STORAGE_RUN_ID = "cookieExtractionRunId";
const STORAGE_FORM = "cookieExtractionForm";

type PageState = "idle" | "restoring" | "running" | "completed" | "stopped" | "error";

function saveFormState(cookiesJson: string, usernames: string, testMode: boolean) {
  sessionStorage.setItem(STORAGE_FORM, JSON.stringify({ cookiesJson, usernames, testMode }));
}

export default function CookieExtractionPage() {
  const [cookiesJson, setCookiesJson] = useState("");
  const [usernames, setUsernames] = useState("");
  const [testMode, setTestMode] = useState(false);
  const [pageState, setPageState] = useState<PageState>("idle");
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const [lastEvent, setLastEvent] = useState<ProgressEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showStopModal, setShowStopModal] = useState(false);
  const [showIssuesModal, setShowIssuesModal] = useState(false);
  const [scrapedSources, setScrapedSources] = useState<ScrapedSource[]>([]);
  const [restoreFailed, setRestoreFailed] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const eventsEndRef = useRef<HTMLDivElement | null>(null);
  const runIdRef = useRef<string | null>(null);

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

  useEffect(() => {
    if ((pageState === "completed" || pageState === "stopped" || pageState === "error") && (knownIssues > 0 || unexpectedErrors > 0)) {
      setShowIssuesModal(true);
    }
  }, [pageState, knownIssues, unexpectedErrors]);

  const startPolling = useCallback(
    (id: string) => {
      pollRef.current = setInterval(async () => {
        try {
          const state = await pollExtractionAction(id);
          if (!state) {
            clearPoll();
            setPageState("idle");
            sessionStorage.removeItem(STORAGE_RUN_ID);
            return;
          }
          setEvents(state.progress as ProgressEvent[]);
          if (state.lastEvent) setLastEvent(state.lastEvent as ProgressEvent);
          if (state.status !== "running") {
            clearPoll();
            sessionStorage.removeItem(STORAGE_RUN_ID);
            if (state.status === "done") setPageState("completed");
            else if (state.status === "error") setPageState("error");
            else if (state.status === "stopped") setPageState("stopped");
          }
        } catch (err) {
          console.error("Poll error:", err);
        }
      }, 1000);
    },
    [clearPoll],
  );

  useEffect(() => {
    eventsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  useEffect(() => {
    const savedRunId = sessionStorage.getItem(STORAGE_RUN_ID);
    if (!savedRunId) return;

    setPageState("restoring");

    const savedForm = sessionStorage.getItem(STORAGE_FORM);
    if (savedForm) {
      try {
        const parsed = JSON.parse(savedForm);
        setCookiesJson(parsed.cookiesJson ?? "");
        setUsernames(parsed.usernames ?? "");
        setTestMode(parsed.testMode ?? false);
      } catch {}
    }

    let cancelled = false;

    (async () => {
      const state = await pollExtractionAction(savedRunId);
      if (cancelled) return;

      if (!state) {
        setRestoreFailed(true);
        setTimeout(() => {
          if (!cancelled) setPageState("idle");
        }, 3000);
        return;
      }

      if (state.lastEvent) setLastEvent(state.lastEvent as ProgressEvent);
      if (state.status === "running") {
        runIdRef.current = savedRunId;
        setEvents(state.progress as ProgressEvent[]);
        setPageState("running");
        startPolling(savedRunId);
      } else {
        setEvents(state.progress as ProgressEvent[]);
        if (state.status === "done") setPageState("completed");
        else if (state.status === "error") setPageState("error");
        else if (state.status === "stopped") setPageState("stopped");
        else {
          sessionStorage.removeItem(STORAGE_RUN_ID);
          setRestoreFailed(true);
          setTimeout(() => {
            if (!cancelled) setPageState("idle");
          }, 3000);
        }
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

    if (!cookiesJson.trim()) {
      setError("Paste your Instagram cookies JSON first");
      return;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(cookiesJson.trim());
      if (!Array.isArray(parsed)) throw new Error();
    } catch {
      setError("Invalid JSON — must be an array of cookie objects");
      return;
    }

    const names = usernames
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (names.length === 0) {
      setError("Enter at least one username");
      return;
    }

    saveFormState(cookiesJson, usernames, testMode);
    setPageState("running");

    const result = await startCookieExtractionAction(cookiesJson.trim(), names, testMode ? 2 : undefined);
    if ("error" in result) {
      setError(result.error as string);
      setPageState("idle");
      return;
    }

    runIdRef.current = result.runId;
    sessionStorage.setItem(STORAGE_RUN_ID, result.runId);
    startPolling(result.runId);
  };

  const handleStop = async () => {
    if (runIdRef.current) {
      await stopExtractionAction(runIdRef.current);
    }
    sessionStorage.removeItem(STORAGE_RUN_ID);
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
    setUsernames((prev) => {
      const lines = prev
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      if (lines.includes(username)) return prev;
      return [...lines, username].join("\n");
    });
  };

  const handleReset = () => {
    clearPoll();
    setPageState("idle");
    setEvents([]);
    setLastEvent(null);
    setError(null);
    setRestoreFailed(false);
    setShowIssuesModal(false);
    sessionStorage.removeItem(STORAGE_RUN_ID);
    runIdRef.current = null;
  };

  const done = lastEvent?.type === "done";
  const totalFollowers = lastEvent?.totalFollowers ?? 0;
  const totalEstimatedFollowers = lastEvent?.totalEstimatedFollowers ?? 0;
  const invalidCount = lastEvent?.invalidCount ?? 0;
  const privateCount = lastEvent?.privateCount ?? 0;
  const duplicateCount = lastEvent?.duplicateCount ?? 0;
  const knownIssues = events.filter((e) => e.kind === "known").length;
  const unexpectedErrors = events.filter((e) => e.kind === "unknown").length;
  const isDev = process.env.NODE_ENV === "development";
  const consoleEvents = isDev ? events : events.filter((e) => e.type !== "follower");
  const processedCount = lastEvent?.processedCount ?? 0;
  const totalCount = lastEvent?.totalCount ?? 0;
  const profileProgress = totalCount > 0 ? Math.round((processedCount / totalCount) * 100) : 0;
  const followerProgress =
    totalEstimatedFollowers > 0 ? Math.round((totalFollowers / totalEstimatedFollowers) * 100) : 0;
  const sessionReqCount = events.filter((e) => e.type === "follower").length;

  const active = pageState === "running" || pageState === "restoring";
  const showProgress = pageState !== "idle" || events.length > 0;

  return (
    <div className="space-y-6 p-6">
      {pageState === "restoring" && !restoreFailed && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex items-center gap-3 pt-6">
            <RefreshCw className="h-5 w-5 animate-spin text-primary" />
            <div>
              <p className="text-sm font-medium">Reconnecting to extraction session...</p>
              <p className="text-xs text-muted-foreground mt-0.5">
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
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                Previous session was lost (server restarted)
              </p>
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
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
          <div className="space-y-2">
            <Label htmlFor="cookies">
              Instagram Cookies JSON
              <span className="text-xs text-muted-foreground ml-2">(paste from browser cookie editor)</span>
            </Label>
            <textarea
              id="cookies"
              className="flex min-h-[180px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 font-mono"
              placeholder='[{"domain":".instagram.com","name":"csrftoken","value":"...", ...}]'
              value={cookiesJson}
              onChange={(e) => setCookiesJson(e.target.value)}
              disabled={active}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="usernames">
              Target Usernames
              <span className="text-xs text-muted-foreground ml-2">(one per line)</span>
            </Label>
            <textarea
              id="usernames"
              className="flex min-h-[100px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 font-mono"
              placeholder={["target_user1", "target_user2"].join("\n")}
              value={usernames}
              onChange={(e) => setUsernames(e.target.value)}
              disabled={active}
            />
          </div>

          {scrapedSources.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground font-medium">Previously extracted — click to add</p>
              <div className="flex flex-wrap gap-1.5">
                {scrapedSources.map((s) => (
                  <button
                    key={s.profileUsername}
                    type="button"
                    disabled={active || s.isPrivate || s.isInvalid}
                    onClick={() => handleExtractSource(s.profileUsername)}
                    className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs hover:bg-muted transition-colors disabled:opacity-40"
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
            <Label htmlFor="test-mode" className="flex items-center gap-1.5 cursor-pointer">
              <Bug className="h-3.5 w-3.5" />
              Test mode — 2 pages per profile
            </Label>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex gap-2">
            {pageState === "idle" && (
              <Button onClick={startExtraction}>
                <Play className="mr-2 h-4 w-4" />
                {testMode ? "Run Test" : "Start Extraction"}
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
                  <div className="flex justify-between text-muted-foreground text-xs mb-1">
                    <span>
                      {processedCount} of {totalCount} profiles
                    </span>
                    <span>{profileProgress}%</span>
                  </div>
                  <Progress value={profileProgress} className="h-2" />
                </div>
                {totalEstimatedFollowers > 0 && (
                  <div>
                    <div className="flex justify-between text-muted-foreground text-xs mb-1">
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
              {pageState === "running" && (
                <Badge variant="secondary" className="gap-1 text-xs">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {sessionReqCount} requests
                </Badge>
              )}
            </div>

            <div className="max-h-[200px] overflow-y-auto space-y-0.5 text-xs font-mono text-muted-foreground border rounded p-2">
              {consoleEvents.map((ev, i) => (
                <div key={i} className="flex gap-2">
                  <span className="shrink-0 w-6 opacity-50">{i + 1}</span>
                  <span
                    className={
                      ev.type === "error"
                        ? "text-destructive"
                        : ev.type === "done"
                          ? "text-green-500"
                          : ev.type === "stopped"
                            ? "text-orange-500"
                            : ev.type === "invalid"
                              ? "text-amber-500"
                              : ev.type === "skipped"
                                ? "text-sky-500 italic"
                                : ev.type === "follower"
                                  ? "text-blue-400"
                                  : ""
                    }
                  >
                    {ev.type === "follower" ? `+ ${ev.followerUsername}` : ev.message || ev.error || ""}
                  </span>
                </div>
              ))}
              <div ref={eventsEndRef} />
            </div>

            {pageState === "running" && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <RefreshCw className="h-3 w-3 animate-spin" />
                Auto-refreshing every second
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Issues Modal */}
      {showIssuesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-md mx-4">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Info className="h-5 w-5 text-sky-500" />
                Extraction finished with issues
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {totalFollowers} followers scraped, but some profiles could not be processed.
              </p>
              {knownIssues > 0 && (
                <div className="rounded-md border border-sky-300/50 bg-sky-50 p-3 space-y-1 dark:bg-sky-950/20">
                  <p className="text-sm font-medium text-sky-700 flex items-center gap-2 dark:text-sky-300">
                    <Info className="h-4 w-4" />
                    {knownIssues} profile{knownIssues !== 1 ? "s" : ""} skipped — known Instagram-side issue
                  </p>
                  <p className="text-xs text-sky-600 dark:text-sky-400">
                    Instagram removed the profile-info schema for business/creator accounts. This is a known change on
                    Instagram's side, not a failure of the extraction — other profiles were unaffected. Retry these later
                    with fresh cookies.
                  </p>
                </div>
              )}
              {unexpectedErrors > 0 && (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 space-y-1">
                  <p className="text-sm font-medium text-destructive flex items-center gap-2">
                    <AlertCircle className="h-4 w-4" />
                    {unexpectedErrors} unexpected error{unexpectedErrors !== 1 ? "s" : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    These are not explained by known Instagram behavior. Likely causes: expired session, proxy/IP flagged,
                    or a rate limit. Check the logs and re-run with fresh cookies.
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
          <Card className="w-full max-w-sm mx-4">
            <CardHeader>
              <CardTitle className="text-lg">Stop Extraction?</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                The current page will finish, then extraction stops.{" "}
                <span className="font-semibold text-destructive">
                  This is destructive — you will NOT be able to resume extraction for these profiles in this session.
                </span>{" "}
                Any followers already scraped will remain in the database.
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
