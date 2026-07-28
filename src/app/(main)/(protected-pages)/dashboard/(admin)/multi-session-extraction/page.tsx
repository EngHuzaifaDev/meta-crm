"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  AlertCircle,
  Ban,
  CheckCircle,
  ClipboardPaste,
  Clock,
  Loader2,
  LogIn,
  Play,
  Plus,
  RefreshCw,
  Terminal,
  Trash2,
  Users,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  getScrapedSourcesAction,
  pollExtractionAction,
  startSessionExtractionAction,
  stopExtractionAction,
} from "@/server/instagram/actions";

interface SessionEntry {
  label: string;
  cookiesJson: string;
}

interface ScrapedProfile {
  profileUsername: string;
  followerCount: number;
  profilePicUrl?: string;
  isPrivate?: boolean;
  isInvalid?: boolean;
}

interface SessionStatus {
  label: string;
  requestCount: number;
  maxPerHour: number;
  coolingDown: boolean;
  cooldownRemainingMs: number;
}

interface ExtractionEvent {
  type: string;
  message?: string;
  error?: string;
  profileUsername?: string;
  followerUsername?: string;
  count?: number;
  totalFollowers?: number;
  totalEstimatedFollowers?: number;
  invalidCount?: number;
  privateCount?: number;
  duplicateCount?: number;
  processedCount?: number;
  totalCount?: number;
  sessions?: SessionStatus[];
}

export default function MultiSessionExtractionPage() {
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [currentLabel, setCurrentLabel] = useState("");
  const [currentCookies, setCurrentCookies] = useState("");
  const [sessionError, setSessionError] = useState<string | null>(null);

  const [usernames, setUsernames] = useState("");
  const [scrapedProfiles, setScrapedProfiles] = useState<ScrapedProfile[]>([]);
  const [selectedProfiles, setSelectedProfiles] = useState<Set<string>>(new Set());

  const [testMode, setTestMode] = useState(false);
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<ExtractionEvent[]>([]);
  const [sessionStatuses, setSessionStatuses] = useState<SessionStatus[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [showStopModal, setShowStopModal] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const eventsEndRef = useRef<HTMLDivElement | null>(null);
  const runIdRef = useRef<string | null>(null);

  useEffect(() => {
    eventsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  useEffect(() => {
    getScrapedSourcesAction(50)
      .then((res) => setScrapedProfiles(res.sources))
      .catch(() => {});
  }, []);

  const clearPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPolling = useCallback(
    (id: string) => {
      let lastEventCount = 0;
      pollRef.current = setInterval(async () => {
        const state = await pollExtractionAction(id);
        if (!state) {
          clearPoll();
          setRunning(false);
          return;
        }
        if (state.progress.length > lastEventCount) {
          const newEvents = state.progress.slice(lastEventCount) as ExtractionEvent[];
          lastEventCount = state.progress.length;
          for (const ev of newEvents) {
            if (ev.type === "sessionsUpdate" && ev.sessions) {
              setSessionStatuses(ev.sessions);
            }
          }
          setEvents((p) => [...p, ...newEvents]);
        }
        if (state.status !== "running") {
          clearPoll();
          setRunning(false);
        }
      }, 1000);
    },
    [clearPoll],
  );

  const addSession = () => {
    setSessionError(null);
    const label = currentLabel.trim();
    if (!label) {
      setSessionError("Enter a session label");
      return;
    }
    if (sessions.some((s) => s.label === label)) {
      setSessionError("Session label already exists");
      return;
    }
    const trimmed = currentCookies.trim();
    if (!trimmed) {
      setSessionError("Paste cookie JSON");
      return;
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) throw new Error();
    } catch {
      setSessionError("Invalid JSON array");
      return;
    }
    setSessions((p) => [...p, { label, cookiesJson: trimmed }]);
    setCurrentLabel("");
    setCurrentCookies("");
  };

  const removeSession = (label: string) => {
    setSessions((p) => p.filter((s) => s.label !== label));
  };

  const toggleProfile = (username: string) => {
    setSelectedProfiles((prev) => {
      const next = new Set(prev);
      if (next.has(username)) next.delete(username);
      else next.add(username);
      return next;
    });
  };

  const startExtraction = async () => {
    if (sessions.length === 0) {
      setError("Add at least one session");
      return;
    }

    const names =
      selectedProfiles.size > 0
        ? Array.from(selectedProfiles)
        : usernames
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean);

    if (names.length === 0) {
      setError("Select or enter at least one username");
      return;
    }

    setError(null);
    setEvents([]);
    setSessionStatuses([]);
    setRunning(true);

    const result = await startSessionExtractionAction(sessions, names, testMode);
    if ("error" in result) {
      setError(result.error as string);
      setRunning(false);
      return;
    }

    runIdRef.current = result.runId;
    startPolling(result.runId);
  };

  const handleStop = async () => {
    if (runIdRef.current) {
      await stopExtractionAction(runIdRef.current);
    }
    setShowStopModal(false);
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
            <RefreshCw className="h-5 w-5" />
            Multi-Session Extraction
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Sessions */}
          <div className="space-y-3">
            <h3 className="font-medium text-sm flex items-center gap-2">
              <LogIn className="h-4 w-4" />
              Sessions ({sessions.length})
            </h3>

            {sessions.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {sessions.map((s) => (
                  <Badge key={s.label} variant="secondary" className="gap-1 pr-1">
                    {s.label}
                    <button
                      type="button"
                      onClick={() => removeSession(s.label)}
                      className="ml-1 rounded-full p-0.5 hover:bg-muted transition-colors"
                      aria-label={`Remove ${s.label}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}

            <div className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
              <input
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
                placeholder="Session label (e.g. Session 1)"
                value={currentLabel}
                onChange={(e) => setCurrentLabel(e.target.value)}
                disabled={running}
              />
              <input
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs font-mono"
                placeholder='[{ "domain":".instagram.com","name":"csrftoken","value":"...", ...}]'
                value={currentCookies}
                onChange={(e) => setCurrentCookies(e.target.value)}
                disabled={running}
              />
              <Button variant="outline" size="sm" onClick={addSession} disabled={running}>
                <Plus className="mr-1 h-4 w-4" />
                Add
              </Button>
            </div>
            {sessionError && <p className="text-xs text-destructive">{sessionError}</p>}
          </div>

          {/* Previously scraped profiles */}
          <div className="space-y-2">
            <h3 className="font-medium text-sm flex items-center gap-2">
              <Users className="h-4 w-4" />
              Previously Extracted Profiles
            </h3>
            <div className="max-h-[200px] overflow-y-auto border rounded-md divide-y">
              {scrapedProfiles.length === 0 ? (
                <p className="p-3 text-xs text-muted-foreground">No previously extracted profiles found</p>
              ) : (
                scrapedProfiles.map((p) => (
                  <label
                    key={p.profileUsername}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted/50 cursor-pointer"
                  >
                    <Checkbox
                      checked={selectedProfiles.has(p.profileUsername)}
                      onCheckedChange={() => toggleProfile(p.profileUsername)}
                      disabled={running || p.isPrivate || p.isInvalid}
                    />
                    <span className={p.isInvalid ? "text-muted-foreground line-through" : ""}>
                      @{p.profileUsername}
                    </span>
                    <span className="text-xs text-muted-foreground ml-auto">
                      {p.followerCount.toLocaleString()} followers
                    </span>
                    {p.isPrivate && (
                      <Badge variant="outline" className="border-violet-300 text-violet-600 text-xs">
                        private
                      </Badge>
                    )}
                  </label>
                ))
              )}
            </div>
          </div>

          {/* Manual usernames */}
          <div className="space-y-2">
            <Label htmlFor="usernames">
              Or enter usernames manually
              <span className="text-xs text-muted-foreground ml-2">(one per line)</span>
            </Label>
            <textarea
              id="usernames"
              className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs font-mono"
              placeholder={["target_user1", "target_user2"].join("\n")}
              value={usernames}
              onChange={(e) => setUsernames(e.target.value)}
              disabled={running}
            />
          </div>

          {/* Controls */}
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <Checkbox
                id="test-mode"
                checked={testMode}
                onCheckedChange={(v) => setTestMode(v === true)}
                disabled={running}
              />
              <Label htmlFor="test-mode" className="flex items-center gap-1.5 cursor-pointer text-sm">
                Test mode — 1 page per session, rotate all
              </Label>
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex gap-2">
            <Button onClick={startExtraction} disabled={running}>
              {running ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Extracting...
                </>
              ) : (
                <>
                  <Play className="mr-2 h-4 w-4" />
                  Start Extraction
                </>
              )}
            </Button>
            {running && (
              <Button variant="destructive" onClick={() => setShowStopModal(true)}>
                <Ban className="mr-2 h-4 w-4" />
                Stop
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Session Status */}
      {sessionStatuses.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Clock className="h-4 w-4" />
              Session Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {sessionStatuses.map((s) => (
                <div key={s.label} className="flex items-center gap-3 text-sm">
                  <span className="font-medium w-28 shrink-0">{s.label}</span>
                  <Progress value={(s.requestCount / s.maxPerHour) * 100} className="h-2 flex-1" />
                  <span className="text-xs text-muted-foreground w-24 text-right">
                    {s.requestCount}/{s.maxPerHour}
                  </span>
                  {s.coolingDown && (
                    <Badge variant="outline" className="border-orange-300 text-orange-600 text-xs whitespace-nowrap">
                      cooling {Math.ceil(s.cooldownRemainingMs / 1000)}s
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Events */}
      {events.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Terminal className="h-5 w-5" />
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

            <div className="max-h-[200px] overflow-y-auto space-y-0.5 text-xs font-mono text-muted-foreground border rounded p-2">
              {events
                .filter((ev) => ev.type !== "sessionsUpdate" && ev.type !== "follower")
                .map((ev, i) => (
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
                                : ""
                      }
                    >
                      {ev.message || ev.error || ""}
                    </span>
                  </div>
                ))}
              <div ref={eventsEndRef} />
            </div>
          </CardContent>
        </Card>
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
                The current page will finish, then extraction stops gracefully. Cursor will be saved so you can resume
                later.
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
