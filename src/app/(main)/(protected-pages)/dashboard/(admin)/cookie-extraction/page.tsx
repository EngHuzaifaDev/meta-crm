"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  AlertCircle,
  Ban,
  CheckCircle,
  ClipboardPaste,
  Download,
  Loader2,
  Lock,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Square,
  Terminal,
  Trash2,
  Users,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  addAccountToRunAction,
  createExtractionRunAction,
  deleteExtractionRunAction,
  getExtractionRunAction,
  getRunFollowersCSVAction,
  listExtractionRunsAction,
  pauseExtractionRunAction,
  stopExtractionRunAction,
  pollExtractionAction,
  removeAccountFromRunAction,
  startExtractionRunAction,
} from "@/server/instagram/actions";
import type { ProgressEvent } from "@/server/instagram/streaming-extractor";

interface RunListItem {
  _id: string;
  label: string;
  status: string;
  accountsCount: number;
  targetCount: number;
  completedCount: number;
  stats: {
    totalFollowers: number;
    totalEstimated: number;
    invalidCount: number;
    privateCount: number;
    duplicateCount: number;
    processedCount: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

interface RunDetail {
  _id: string;
  label: string;
  accounts: Array<{
    label: string;
    ds_user_id: string;
    isActive: boolean;
    errorCount: number;
  }>;
  targetUsernames: string[];
  completedUsernames: string[];
  currentUsernameIndex: number;
  status: string;
  stats: {
    totalFollowers: number;
    totalEstimated: number;
    invalidCount: number;
    privateCount: number;
    duplicateCount: number;
    processedCount: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

export default function CookieExtractionPage() {
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [run, setRun] = useState<RunDetail | null>(null);
  const [creating, setCreating] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newUsernames, setNewUsernames] = useState("");
  const [addingAccount, setAddingAccount] = useState(false);
  const [accountLabel, setAccountLabel] = useState("");
  const [accountCookies, setAccountCookies] = useState("");
  const [memRunId, setMemRunId] = useState<string | null>(null);
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const eventsEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void listExtractionRunsAction().then(setRuns);
  }, []);

  useEffect(() => {
    eventsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const loadRun = useCallback(async (id: string) => {
    const detail = await getExtractionRunAction(id);
    if (detail && "label" in detail) {
      setRun(detail as unknown as RunDetail);
    } else {
      setRun(null);
    }
  }, []);

  useEffect(() => {
    if (selectedRunId) void loadRun(selectedRunId);
  }, [selectedRunId, loadRun]);

  const refreshRuns = useCallback(async () => {
    const list = await listExtractionRunsAction();
    setRuns(list);
  }, []);

  const selectRun = useCallback((id: string) => {
    setSelectedRunId(id);
    setEvents([]);
    setMemRunId(null);
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  const handleCreate = async () => {
    if (!newLabel.trim() || !newUsernames.trim()) return;
    setBusy(true);
    const result = await createExtractionRunAction(
      newLabel.trim(),
      newUsernames
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    );
    if ("runId" in result) {
      setNewLabel("");
      setNewUsernames("");
      setCreating(false);
      await refreshRuns();
      if (result.runId) selectRun(result.runId);
    }
    setBusy(false);
  };

  const handleAddAccount = async () => {
    if (!selectedRunId || !accountCookies.trim()) return;
    setBusy(true);
    await addAccountToRunAction(selectedRunId, accountLabel.trim(), accountCookies.trim());
    setAccountLabel("");
    setAccountCookies("");
    setAddingAccount(false);
    await loadRun(selectedRunId);
    await refreshRuns();
    setBusy(false);
  };

  const handleRemoveAccount = async (dsUserId: string) => {
    if (!selectedRunId) return;
    setBusy(true);
    await removeAccountFromRunAction(selectedRunId, dsUserId);
    await loadRun(selectedRunId);
    await refreshRuns();
    setBusy(false);
  };

  const handleStart = async () => {
    if (!selectedRunId) return;
    setBusy(true);
    setEvents([]);
    const result = await startExtractionRunAction(selectedRunId);
    if ("memRunId" in result && result.memRunId) {
      setMemRunId(result.memRunId);
      const memId = result.memRunId;
      pollRef.current = setInterval(async () => {
        const state = await pollExtractionAction(memId);
        if (state?.lastEvent) {
          setEvents((p) => [...p, state.lastEvent as ProgressEvent]);
        }
        if (!state || state.status === "done" || state.status === "error") {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setMemRunId(null);
          if (selectedRunId) void loadRun(selectedRunId);
          void refreshRuns();
        }
      }, 1000);
    }
    setBusy(false);
  };

  const handlePause = async () => {
    if (!selectedRunId) return;
    setBusy(true);
    await pauseExtractionRunAction(selectedRunId);
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    setMemRunId(null);
    await loadRun(selectedRunId);
    await refreshRuns();
    setBusy(false);
  };

  const handleStop = async () => {
    if (!selectedRunId) return;
    setBusy(true);
    await stopExtractionRunAction(selectedRunId);
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    setMemRunId(null);
    await loadRun(selectedRunId);
    await refreshRuns();
    setBusy(false);
  };

  const handleDelete = async () => {
    if (!selectedRunId) return;
    setBusy(true);
    await deleteExtractionRunAction(selectedRunId);
    setSelectedRunId(null);
    setRun(null);
    setEvents([]);
    setMemRunId(null);
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    await refreshRuns();
    setBusy(false);
  };

  const handleDownloadCSV = async () => {
    if (!selectedRunId) return;
    const result = await getRunFollowersCSVAction(selectedRunId);
    if ("csv" in result) {
      const blob = new Blob([result.csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.filename;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const isRunning = run?.status === "running";
  const isPaused = run?.status === "paused";
  const isIdle = run?.status === "idle";
  const isDone = run?.status === "completed";
  const isError = run?.status === "error";

  const last = events[events.length - 1];
  const totalFollowers = last?.totalFollowers ?? run?.stats?.totalFollowers ?? 0;
  const totalEstimated = last?.totalEstimatedFollowers ?? run?.stats?.totalEstimated ?? 0;
  const invalidCount = last?.invalidCount ?? run?.stats?.invalidCount ?? 0;
  const privateCount = last?.privateCount ?? run?.stats?.privateCount ?? 0;
  const duplicateCount = last?.duplicateCount ?? run?.stats?.duplicateCount ?? 0;
  const processedCount = last?.processedCount ?? run?.stats?.processedCount ?? 0;
  const totalCount = last?.totalCount ?? run?.targetUsernames?.length ?? 0;
  const profileProgress = totalCount > 0 ? Math.round((processedCount / totalCount) * 100) : 0;
  const followerProgress = totalEstimated > 0 ? Math.round((totalFollowers / totalEstimated) * 100) : 0;

  return (
    <div className="flex h-full gap-6 p-6">
      <div className="w-80 shrink-0 space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Terminal className="h-4 w-4" />
              Extraction Runs
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {runs.length === 0 && !creating && <p className="text-muted-foreground text-sm">No runs yet</p>}
            {runs.map((r) => (
              <button type="button"
                key={r._id}
                onClick={() => selectRun(r._id)}
                className={`w-full rounded-lg border p-3 text-left text-sm transition-colors ${
                  selectedRunId === r._id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-muted-foreground/30"
                }`}
              >
                <div className="truncate font-medium">{r.label}</div>
                <div className="mt-1 flex items-center gap-2">
                  <Badge
                    variant={
                      r.status === "running"
                        ? "default"
                        : r.status === "completed"
                          ? "secondary"
                          : r.status === "paused"
                            ? "outline"
                            : r.status === "error"
                              ? "destructive"
                              : "outline"
                    }
                    className="px-1.5 py-0 text-[10px]"
                  >
                    {r.status}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground">
                    {r.accountsCount} accts &middot; {r.completedCount}/{r.targetCount} profiles
                  </span>
                </div>
              </button>
            ))}
            {creating ? (
              <div className="space-y-2 border-t pt-2">
                <Input placeholder="Run label" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
                <textarea
                  className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                  placeholder="target_user1&#10;target_user2"
                  value={newUsernames}
                  onChange={(e) => setNewUsernames(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleCreate} disabled={busy}>
                    {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle className="h-3 w-3" />}
                    Create
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="outline" size="sm" className="w-full" onClick={() => setCreating(true)}>
                <Plus className="mr-1 h-3.5 w-3.5" />
                New Run
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="min-w-0 flex-1 space-y-6">
        {!selectedRunId && (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <Terminal className="mx-auto mb-3 h-12 w-12 opacity-30" />
              <p>Select or create an extraction run to begin</p>
            </CardContent>
          </Card>
        )}

        {selectedRunId && !run && (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              <Loader2 className="mx-auto h-6 w-6 animate-spin" />
            </CardContent>
          </Card>
        )}

        {run && (
          <>
            <Card>
              <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
                <div>
                  <CardTitle className="flex items-center gap-3 text-xl">
                    {run.label}
                    <Badge
                      variant={
                        isRunning
                          ? "default"
                          : isDone
                            ? "secondary"
                            : isPaused
                              ? "outline"
                              : isError
                                ? "destructive"
                                : "outline"
                      }
                    >
                      {run.status}
                    </Badge>
                  </CardTitle>
                  <CardDescription>
                    {run.targetUsernames.length} targets &middot; {run.accounts.length} accounts &middot; created{" "}
                    {new Date(run.createdAt).toLocaleDateString()}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  {isIdle && (
                    <Button size="sm" onClick={handleStart} disabled={busy || run.accounts.length === 0}>
                      <Play className="mr-1 h-3.5 w-3.5" />
                      Start
                    </Button>
                  )}
                  {isRunning && (
                    <>
                      <Button size="sm" variant="secondary" onClick={handlePause} disabled={busy}>
                        <Pause className="mr-1 h-3.5 w-3.5" />
                        Pause
                      </Button>
                      <Button size="sm" variant="destructive" onClick={handleStop} disabled={busy}>
                        <Square className="mr-1 h-3.5 w-3.5" />
                        Stop
                      </Button>
                    </>
                  )}
                  {isPaused && (
                    <Button size="sm" onClick={handleStart} disabled={busy}>
                      <RotateCcw className="mr-1 h-3.5 w-3.5" />
                      Resume
                    </Button>
                  )}
                  {isDone && (
                    <Button size="sm" variant="secondary" onClick={handleDownloadCSV}>
                      <Download className="mr-1 h-3.5 w-3.5" />
                      CSV
                    </Button>
                  )}
                  {isIdle && (
                    <Button size="sm" variant="destructive" onClick={handleDelete} disabled={busy}>
                      <Trash2 className="mr-1 h-3.5 w-3.5" />
                      Delete
                    </Button>
                  )}
                </div>
              </CardHeader>
            </Card>

            <div className="grid grid-cols-2 gap-6">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Users className="h-4 w-4" />
                    Accounts
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {run.accounts.length === 0 && !addingAccount && (
                    <p className="text-muted-foreground text-sm">No accounts added</p>
                  )}
                  {run.accounts.map((acct) => (
                    <div key={acct.ds_user_id} className="flex items-center justify-between rounded border p-2 text-sm">
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${acct.isActive ? "bg-green-500" : "bg-red-500"}`}
                        />
                        <span className="truncate">{acct.label}</span>
                        <code className="hidden text-[10px] text-muted-foreground sm:inline">
                          {acct.ds_user_id.slice(0, 12)}...
                        </code>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-destructive"
                        onClick={() => handleRemoveAccount(acct.ds_user_id)}
                        disabled={busy}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                  {addingAccount ? (
                    <div className="space-y-2 border-t pt-2">
                      <Input
                        placeholder="Account label"
                        value={accountLabel}
                        onChange={(e) => setAccountLabel(e.target.value)}
                      />
                      <textarea
                        className="flex min-h-[100px] w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                        placeholder={`[{"domain":".instagram.com","name":"csrftoken","value":"...", ...}]`}
                        value={accountCookies}
                        onChange={(e) => setAccountCookies(e.target.value)}
                      />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={handleAddAccount} disabled={busy || !accountCookies.trim()}>
                          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle className="h-3 w-3" />}
                          Add
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setAddingAccount(false)}>
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => setAddingAccount(true)}
                      disabled={!isIdle}
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" />
                      Add Account
                    </Button>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <ClipboardPaste className="h-4 w-4" />
                    Targets
                  </CardTitle>
                </CardHeader>
                <CardContent className="max-h-[300px] space-y-1 overflow-y-auto">
                  {run.targetUsernames.map((u, i) => {
                    const completed = run.completedUsernames.includes(u);
                    const isCurrent = i === run.currentUsernameIndex && isRunning;
                    return (
                      <div
                        key={u}
                        className={`flex items-center gap-2 rounded p-1.5 text-sm ${
                          isCurrent ? "bg-primary/10 font-medium" : ""
                        } ${completed ? "text-muted-foreground" : ""}`}
                      >
                        {completed ? (
                          <CheckCircle className="h-3.5 w-3.5 shrink-0 text-green-500" />
                        ) : isCurrent ? (
                          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
                        ) : (
                          <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-muted-foreground/30" />
                        )}
                        <span className="truncate">@{u}</span>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            </div>

            {(memRunId || isRunning || isDone) && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Terminal className="h-4 w-4" />
                    Progress
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {totalCount > 0 && (
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
                      {totalEstimated > 0 && (
                        <div>
                          <div className="mb-1 flex justify-between text-muted-foreground text-xs">
                            <span>
                              {totalFollowers.toLocaleString()} of ~{totalEstimated.toLocaleString()} followers
                            </span>
                            <span>{followerProgress}%</span>
                          </div>
                          <Progress value={followerProgress} className="h-1.5" />
                        </div>
                      )}
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
                    {isDone && (
                      <Badge className="gap-1 bg-green-600 text-sm">
                        <CheckCircle className="h-3.5 w-3.5" />
                        Complete
                      </Badge>
                    )}
                  </div>

                  {last?.message && (
                    <div className="flex items-center gap-2 text-sm">
                      {isRunning && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                      <span>
                        {last.profileUsername && <span className="font-medium">@{last.profileUsername}</span>}{" "}
                        {last.message}
                      </span>
                    </div>
                  )}

                  <div className="max-h-[200px] space-y-0.5 overflow-y-auto rounded border p-2 font-mono text-muted-foreground text-xs">
                    {events.map((ev, i) => (
                      /* biome-ignore lint/suspicious/noArrayIndexKey: event log is static */
                      <div key={i} className="flex gap-2">
                        <span className="w-6 shrink-0 opacity-50">{i + 1}</span>
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
          </>
        )}
      </div>
    </div>
  );
}
