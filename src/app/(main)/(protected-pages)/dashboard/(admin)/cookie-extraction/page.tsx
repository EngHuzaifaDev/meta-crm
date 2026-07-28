"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { AlertCircle, Ban, Bug, CheckCircle, ClipboardPaste, Loader2, Lock, Play, Terminal, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { pollExtractionAction, startCookieExtractionAction } from "@/server/instagram/actions";
import type { ProgressEvent } from "@/server/instagram/streaming-extractor";

export default function CookieExtractionPage() {
  const [cookiesJson, setCookiesJson] = useState("");
  const [usernames, setUsernames] = useState("");
  const [testMode, setTestMode] = useState(false);
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const eventsEndRef = useRef<HTMLDivElement | null>(null);
  const runIdRef = useRef<string | null>(null);

  const clearPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPolling = useCallback((id: string) => {
    let lastEventCount = 0;
    pollRef.current = setInterval(async () => {
      const state = await pollExtractionAction(id);
      if (!state) {
        clearPoll();
        setRunning(false);
        sessionStorage.removeItem("cookieExtractionRunId");
        return;
      }
      if (state.progress.length > lastEventCount) {
        const newEvents = state.progress.slice(lastEventCount) as ProgressEvent[];
        lastEventCount = state.progress.length;
        setEvents((p) => [...p, ...newEvents]);
      }
      if (state.status !== "running") {
        clearPoll();
        setRunning(false);
        sessionStorage.removeItem("cookieExtractionRunId");
      }
    }, 1000);
  }, [clearPoll]);

  useEffect(() => {
    const saved = sessionStorage.getItem("cookieExtractionRunId");
    if (!saved) return;
    let cancelled = false;
    (async () => {
      const state = await pollExtractionAction(saved);
      if (cancelled) return;
      if (!state || state.status !== "running") {
        sessionStorage.removeItem("cookieExtractionRunId");
        return;
      }
      runIdRef.current = saved;
      setEvents(state.progress as ProgressEvent[]);
      setRunning(true);
      startPolling(saved);
    })();
    return () => { cancelled = true; clearPoll(); };
  }, [clearPoll, startPolling]);

  const startExtraction = async () => {
    setError(null);
    setEvents([]);

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

    const targetNames = names;
    if (testMode) {
      setEvents([
        {
          type: "status",
          message: `TEST MODE — fetching 2 pages per profile (${targetNames.length} profiles total)`,
          totalCount: targetNames.length,
        },
      ]);
    }

    setRunning(true);

    const result = await startCookieExtractionAction(cookiesJson.trim(), targetNames, testMode ? 2 : undefined);
    if ("error" in result) {
      setError(result.error as string);
      setRunning(false);
      return;
    }

    const runId = result.runId;
    runIdRef.current = runId;
    sessionStorage.setItem("cookieExtractionRunId", runId);
    startPolling(runId);
  };

  const last = events[events.length - 1];
  const done = last?.type === "done";
  const totalFollowers = last?.totalFollowers ?? 0;
  const totalEstimatedFollowers = last?.totalEstimatedFollowers ?? 0;
  const invalidCount = last?.invalidCount ?? 0;
  const privateCount = last?.privateCount ?? 0;
  const duplicateCount = last?.duplicateCount ?? 0;
  const processedCount = last?.processedCount ?? 0;
  const totalCount = last?.totalCount ?? 0;
  const profileProgress = totalCount > 0 ? Math.round((processedCount / totalCount) * 100) : 0;
  const followerProgress =
    totalEstimatedFollowers > 0 ? Math.round((totalFollowers / totalEstimatedFollowers) * 100) : 0;

  return (
    <div className="space-y-6 p-6">
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
              disabled={running}
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
              disabled={running}
            />
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="test-mode"
              checked={testMode}
              onCheckedChange={(v) => setTestMode(v === true)}
              disabled={running}
            />
            <Label htmlFor="test-mode" className="flex items-center gap-1.5 cursor-pointer">
              <Bug className="h-3.5 w-3.5" />
              Test mode — fetch 2 pages per profile (quick check)
            </Label>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button onClick={startExtraction} disabled={running}>
            {running ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Extracting...
              </>
            ) : (
              <>
                <Play className="mr-2 h-4 w-4" />
                {testMode ? "Run Test" : "Start Extraction"}
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {events.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ClipboardPaste className="h-5 w-5" />
              Progress
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {running && totalCount > 0 && (
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

            {last?.message && (
              <div className="flex items-center gap-2 text-sm">
                {running && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                <span>
                  {last.profileUsername ? <span className="font-medium">@{last.profileUsername}</span> : null}{" "}
                  {last.message}
                </span>
              </div>
            )}

            <div className="flex flex-wrap gap-3">
              <Badge variant="secondary" className="gap-1 text-sm">
                <Users className="h-3.5 w-3.5" />
                {totalFollowers} followers
              </Badge>
              <Badge variant="outline" className="gap-1 border-amber-300 text-amber-600 text-sm">
                <Ban className="h-3.5 w-3.5" />
                {invalidCount} invalid
              </Badge>
              <Badge
                variant="outline"
                className="gap-1 border-violet-300 text-sm text-violet-600 dark:border-violet-800 dark:text-violet-400"
              >
                <Lock className="h-3.5 w-3.5" />
                {privateCount} private
              </Badge>
              <Badge variant="outline" className="gap-1 text-muted-foreground text-sm">
                <AlertCircle className="h-3.5 w-3.5" />
                {duplicateCount} duplicates
              </Badge>
              {done && (
                <Badge className="gap-1 bg-green-600 text-sm">
                  <CheckCircle className="h-3.5 w-3.5" />
                  Complete
                </Badge>
              )}
            </div>

            <div className="max-h-[200px] overflow-y-auto space-y-0.5 text-xs font-mono text-muted-foreground border rounded p-2">
              {events.map((ev, i) => (
                <div key={i} className="flex gap-2">
                  <span className="shrink-0 w-6 opacity-50">{i + 1}</span>
                  <span
                    className={
                      ev.type === "error"
                        ? "text-destructive"
                        : ev.type === "done"
                          ? "text-green-500"
                          : ev.type === "invalid"
                            ? "text-amber-500"
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
          </CardContent>
        </Card>
      )}
    </div>
  );
}
