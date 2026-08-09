"use client";

import { useEffect, useState } from "react";

import { AlertTriangle, Loader2, RefreshCw, Shield, Trash2, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  deleteProfileDataAction,
  getFailedTasksAction,
  getProfilesWithStatsAction,
  retryFailedTaskAction,
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
  completedAt: string;
}

export default function AdminPage() {
  const [profiles, setProfiles] = useState<ProfileStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [failedTasks, setFailedTasks] = useState<FailedTask[]>([]);
  const [failedTotal, setFailedTotal] = useState(0);
  const [loadingFailed, setLoadingFailed] = useState(true);
  const [retrying, setRetrying] = useState<string | null>(null);

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
          <p className="text-sm text-muted-foreground">
            {profiles.length} profiles &middot; {totalFollowers.toLocaleString()} total followers
          </p>
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
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading profiles...
            </div>
          ) : profiles.length === 0 ? (
            <p className="text-sm text-muted-foreground">No profiles extracted yet.</p>
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
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
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
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading failed tasks...
            </div>
          ) : failedTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No failed extractions.</p>
          ) : (
            <div className="space-y-2">
              {failedTasks.map((t) => (
                <div
                  key={t.runId}
                  className="flex items-center justify-between rounded-md border border-red-200 bg-red-50 p-3"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">@{t.profileUsername}</span>
                      {t.errorType && (
                        <Badge variant="outline" className="border-red-300 text-red-600 text-xs">
                          {t.errorType}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-red-700 truncate max-w-md">{t.error}</p>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>
                        {t.totalFetched} of {t.estimatedTotal} followers
                      </span>
                      <span>Failed: {new Date(t.completedAt).toLocaleDateString()}</span>
                      <span>Created: {new Date(t.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
