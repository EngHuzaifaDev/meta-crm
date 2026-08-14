"use client";

import { useEffect, useState } from "react";

import { AlertTriangle, Ban, GitMerge, Loader2, RefreshCw, Shield, Trash2, Users, Wrench, Zap } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { getCollectiveExport, getFollowerTargetM, setCollectiveExport, setFollowerTargetM } from "@/lib/dev-settings";
import {
  deleteProfileDataAction,
  getFailedTasksAction,
  getHarvestDuplicatesAction,
  getProfilesWithStatsAction,
  getRunningTasksAction,
  mergeHarvestDuplicatesAction,
  retryFailedTaskAction,
  stopExtractionAction,
} from "@/server/instagram/actions";

interface ProfileStat {
  profileUsername: string;
  followerCount: number;
  lastScrapedAt: string | null;
  isPrivate: boolean;
  isInvalid: boolean;
}

interface FailedTask {
  runId: string;
  profileUsername: string;
  status: string;
  error?: string;
  errorType?: string;
  totalFetched: number;
  estimatedTotal: number;
  createdAt: string;
  startedAt?: string;
  completedAt: string;
}

interface RunningTask {
  runId: string;
  profileUsername: string;
  batchId: string | null;
  startedAt: string | null;
}

const ERROR_TYPE_LABELS: Record<string, string> = {
  SESSION_EXPIRED: "Session expired",
  PROXY_FAILED: "Proxy failed",
  RATE_LIMITED: "Rate limited",
  UNKNOWN: "Unknown error",
};

function elapsedSince(startedAt: string | null, now: number): string {
  if (!startedAt) return "";
  const seconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

export default function AdminPage() {
  const [profiles, setProfiles] = useState<ProfileStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [failedTasks, setFailedTasks] = useState<FailedTask[]>([]);
  const [failedTotal, setFailedTotal] = useState(0);
  const [loadingFailed, setLoadingFailed] = useState(true);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [collectiveExport, setCollective] = useState(false);
  const [runningTasks, setRunningTasks] = useState<RunningTask[]>([]);
  const [loadingRunning, setLoadingRunning] = useState(true);
  const [stopping, setStopping] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [targetInput, setTargetInput] = useState(String(getFollowerTargetM()));
  const [duplicates, setDuplicates] = useState<string[] | null>(null);
  const [checkingDupes, setCheckingDupes] = useState(false);
  const [mergingDupes, setMergingDupes] = useState(false);

  useEffect(() => {
    setCollective(getCollectiveExport());
  }, []);

  const handleCheckDuplicates = async () => {
    setCheckingDupes(true);
    const result = await getHarvestDuplicatesAction();
    if (!("error" in result)) setDuplicates(result.duplicates as string[]);
    setCheckingDupes(false);
  };

  const handleMergeDuplicates = async () => {
    setMergingDupes(true);
    const result = await mergeHarvestDuplicatesAction();
    if (!("error" in result)) setDuplicates(result.dropped as string[]);
    setMergingDupes(false);
  };

  const handleTargetChange = (value: string) => {
    setTargetInput(value);
    const parsed = parseFloat(value);
    if (Number.isFinite(parsed) && parsed > 0) setFollowerTargetM(parsed);
  };

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await getRunningTasksAction();
      if (!cancelled && !("error" in result)) {
        setRunningTasks(result.tasks as RunningTask[]);
        setLoadingRunning(false);
      }
    })();
    const poll = setInterval(() => {
      void getRunningTasksAction().then((result) => {
        if (!("error" in result)) setRunningTasks(result.tasks as RunningTask[]);
      });
    }, 5000);
    return () => {
      cancelled = true;
      clearInterval(poll);
    };
  }, []);

  const handleStopTask = async (runId: string) => {
    setStopping(runId);
    await stopExtractionAction(runId);
    setRunningTasks((prev) => prev.filter((t) => t.runId !== runId));
    setStopping(null);
  };

  const handleCollectiveToggle = (v: boolean) => {
    setCollective(v);
    setCollectiveExport(v);
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const data = await getProfilesWithStatsAction();
      if (!cancelled) setProfiles(data as ProfileStat[]);
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await getFailedTasksAction();
      if ("error" in result) return;
      if (!cancelled) {
        setFailedTasks(result.tasks as FailedTask[]);
        setFailedTotal(result.total);
        setLoadingFailed(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleDelete = async (username: string) => {
    if (!confirm(`Delete all data for @${username}? This cannot be undone.`)) return;
    setDeleting(username);
    const result = await deleteProfileDataAction(username);
    if ("error" in result) {
      alert(result.error);
    } else {
      setProfiles((p) => p.filter((x) => x.profileUsername !== username));
    }
    setDeleting(null);
  };

  const handleRetry = async (runId: string) => {
    setRetrying(runId);
    const result = await retryFailedTaskAction(runId);
    if ("error" in result) {
      alert(result.error);
    } else {
      setFailedTasks((prev) => prev.filter((t) => t.runId !== runId));
      setFailedTotal((prev) => prev - 1);
    }
    setRetrying(null);
  };

  const totalFollowers = profiles.reduce((s, p) => s + p.followerCount, 0);

  return (
    <div className="space-y-6 p-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Admin — Profile Management
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            {profiles.length} profiles &middot; {totalFollowers.toLocaleString()} total followers
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Zap className="h-4 w-4" />
            Active Extraction Sessions
            {runningTasks.length > 0 && (
              <Badge className="ml-1 bg-amber-500 text-xs">{runningTasks.length} running</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadingRunning ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking active sessions...
            </div>
          ) : runningTasks.length === 0 ? (
            <p className="text-muted-foreground text-sm">No extraction sessions running.</p>
          ) : (
            <div className="space-y-2">
              {runningTasks.map((t) => (
                <div
                  key={t.runId}
                  className="flex items-center justify-between rounded-md border border-amber-200 bg-amber-50 p-3 dark:bg-amber-950/10"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-600" />
                      <span className="font-medium text-sm">@{t.profileUsername}</span>
                      <Badge variant="outline" className="border-amber-300 text-amber-600 text-xs">
                        running
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 text-muted-foreground text-xs">
                      <span>Started {elapsedSince(t.startedAt, now)} ago</span>
                      {t.batchId && <span className="font-mono">batch {t.batchId.slice(0, 8)}</span>}
                      <span className="font-mono">run {t.runId.slice(0, 8)}</span>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={stopping === t.runId}
                    onClick={() => handleStopTask(t.runId)}
                  >
                    {stopping === t.runId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
                    <span className="ml-1">Stop</span>
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Wrench className="h-4 w-4" />
            Developer Settings
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <p className="font-medium text-sm">Collective CSV export</p>
              <p className="text-muted-foreground text-xs">
                When enabled, the Export CSV button on the Followers page downloads all followers across every profile.
                When disabled, it only includes the first profile's followers.
              </p>
            </div>
            <Switch
              checked={collectiveExport}
              onCheckedChange={handleCollectiveToggle}
              aria-label="Collective CSV export"
            />
          </div>

          <div className="mt-5 flex items-center justify-between gap-4 border-t pt-5">
            <div className="space-y-1">
              <p className="font-medium text-sm">Follower target (millions)</p>
              <p className="text-muted-foreground text-xs">
                The celebration target shown on the Followers page. Accepts a float, e.g. 16 or 16.5.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0.1}
                step={0.1}
                value={targetInput}
                onChange={(e) => handleTargetChange(e.target.value)}
                className="h-9 w-28 text-right"
                aria-label="Follower target in millions"
              />
              <span className="text-muted-foreground text-xs">M</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <GitMerge className="h-4 w-4" />
            Harvested Duplicates
            {duplicates && (
              <Badge variant={duplicates.length > 0 ? "destructive" : "secondary"} className="ml-1 text-xs">
                {duplicates.length}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground text-xs">
            Checks comments-harvested profiles against extracted followers. Duplicates are removed from the harvested
            side only — follower data is never touched.
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCheckDuplicates}
              disabled={checkingDupes || mergingDupes}
            >
              {checkingDupes ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              <span className="ml-1">Check duplicates</span>
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleMergeDuplicates}
              disabled={checkingDupes || mergingDupes || (duplicates !== null && duplicates.length === 0)}
            >
              {mergingDupes ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              <span className="ml-1">Merge (remove from harvested)</span>
            </Button>
          </div>
          {duplicates && duplicates.length > 0 && (
            <div className="max-h-48 space-y-0.5 overflow-y-auto rounded-md border bg-red-50 p-3 dark:bg-red-950/10">
              <p className="text-muted-foreground text-xs">
                {mergingDupes
                  ? "Removing these profiles from comments harvest..."
                  : "Profiles already in followers — dropped from comments harvest on merge:"}
              </p>
              {duplicates.map((name) => (
                <p key={name} className="font-mono text-xs">
                  @{name}
                </p>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4" />
            All Profiles
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading profiles...
            </div>
          ) : profiles.length === 0 ? (
            <p className="text-muted-foreground text-sm">No profiles extracted yet.</p>
          ) : (
            <div className="space-y-2">
              {profiles.map((p) => (
                <div key={p.profileUsername} className="flex items-center justify-between rounded-md border p-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">@{p.profileUsername}</span>
                      {p.isPrivate && (
                        <Badge variant="outline" className="border-violet-300 text-violet-600 text-xs">
                          private
                        </Badge>
                      )}
                      {p.isInvalid && (
                        <Badge variant="outline" className="border-amber-300 text-amber-600 text-xs">
                          invalid
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-muted-foreground text-xs">
                      <span>{p.followerCount.toLocaleString()} followers</span>
                      {p.lastScrapedAt && <span>Last scraped: {new Date(p.lastScrapedAt).toLocaleDateString()}</span>}
                    </div>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={deleting === p.profileUsername}
                    onClick={() => handleDelete(p.profileUsername)}
                  >
                    {deleting === p.profileUsername ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4" />
            Failed Extractions
            {failedTotal > 0 && (
              <Badge variant="destructive" className="ml-1 text-xs">
                {failedTotal}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadingFailed ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading failed tasks...
            </div>
          ) : failedTasks.length === 0 ? (
            <p className="text-muted-foreground text-sm">No failed extractions.</p>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(
                  failedTasks.reduce<Record<string, number>>((acc, t) => {
                    const key = t.errorType ?? "UNKNOWN";
                    acc[key] = (acc[key] ?? 0) + 1;
                    return acc;
                  }, {}),
                ).map(([type, count]) => (
                  <Badge key={type} variant="outline" className="border-red-300 text-red-600 text-xs">
                    {ERROR_TYPE_LABELS[type] ?? type}: {count}
                  </Badge>
                ))}
              </div>
              <div className="space-y-2">
                {failedTasks.map((t) => (
                  <div
                    key={t.runId}
                    className="flex items-start justify-between gap-3 rounded-md border border-red-200 bg-red-50 p-3"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">@{t.profileUsername}</span>
                        {t.errorType && (
                          <Badge variant="outline" className="border-red-300 text-red-600 text-xs">
                            {ERROR_TYPE_LABELS[t.errorType] ?? t.errorType}
                          </Badge>
                        )}
                      </div>
                      {t.error && <p className="break-words text-red-700 text-xs">{t.error}</p>}
                      <div className="flex flex-wrap items-center gap-3 text-muted-foreground text-xs">
                        {t.startedAt && (
                          <span>
                            Ran{" "}
                            {Math.max(
                              0,
                              Math.floor((new Date(t.completedAt).getTime() - new Date(t.startedAt).getTime()) / 1000),
                            )}
                            s
                          </span>
                        )}
                        <span>Failed {new Date(t.completedAt).toLocaleDateString()}</span>
                        <span className="font-mono">run {t.runId.slice(0, 8)}</span>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      disabled={retrying === t.runId}
                      onClick={() => handleRetry(t.runId)}
                    >
                      {retrying === t.runId ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                      <span className="ml-1">Retry</span>
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
