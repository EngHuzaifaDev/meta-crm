"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  AlertCircle,
  Ban,
  CheckCircle,
  Loader2,
  ShieldAlert,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";

import {
  startExtractionAction,
  pollExtractionAction,
  stopExtractionAction,
  resolve2FAAction,
} from "@/server/instagram/actions";

interface FollowerEntry {
  username: string
  avatarUrl?: string
}

interface ProgressEvent {
  type: "status" | "follower" | "invalid" | "duplicate" | "skipped" | "done" | "error" | "2fa_required";
  profileUsername?: string;
  message?: string;
  followerUsername?: string;
  count?: number;
  totalFollowers?: number;
  invalidCount?: number;
  duplicateCount?: number;
  processedCount?: number;
  totalCount?: number;
  error?: string;
  credentialId?: string;
}

export default function ExtractorPage() {
  const [usernames, setUsernames] = useState("");
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [followers, setFollowers] = useState<FollowerEntry[]>([]);
  const [totalFollowers, setTotalFollowers] = useState(0);
  const [invalidCount, setInvalidCount] = useState(0);
  const [duplicateCount, setDuplicateCount] = useState(0);
  const [processedCount, setProcessedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [show2FA, setShow2FA] = useState(false);
  const [pendingCredentialId, setPendingCredentialId] = useState<string | null>(null);
  const [verificationCode, setVerificationCode] = useState("");
  const [submitting2FA, setSubmitting2FA] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runIdRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const poll = useCallback(async (runId: string) => {
    const state = await pollExtractionAction(runId);
    if (!state || state.status === "not_found") {
      setStatus("Run not found");
      setRunning(false);
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }

    const last = state.lastEvent;
    if (!last) return;

    const counts = {
      totalFollowers: last.totalFollowers,
      invalidCount: last.invalidCount,
      duplicateCount: last.duplicateCount,
      processedCount: last.processedCount,
      totalCount: last.totalCount,
    }

    switch (last.type) {
      case "status":
        setStatus(last.message || null);
        if (counts.totalFollowers !== undefined) setTotalFollowers(counts.totalFollowers);
        if (counts.invalidCount !== undefined) setInvalidCount(counts.invalidCount);
        if (counts.duplicateCount !== undefined) setDuplicateCount(counts.duplicateCount);
        setProcessedCount(counts.processedCount ?? 0);
        setTotalCount(counts.totalCount ?? 0);
        break;
      case "follower":
        setFollowers((prev) => [...prev, { username: last.followerUsername! }]);
        setTotalFollowers(counts.totalFollowers ?? 0);
        setDuplicateCount(counts.duplicateCount ?? 0);
        setInvalidCount(counts.invalidCount ?? 0);
        setProcessedCount(counts.processedCount ?? 0);
        setTotalCount(counts.totalCount ?? 0);
        break;
      case "invalid":
        if (counts.invalidCount !== undefined) setInvalidCount(counts.invalidCount);
        setProcessedCount(counts.processedCount ?? 0);
        break;
      case "duplicate":
        if (counts.duplicateCount !== undefined) setDuplicateCount(counts.duplicateCount);
        break;
      case "skipped":
        setStatus(last.message || null);
        setProcessedCount(counts.processedCount ?? 0);
        setTotalCount(counts.totalCount ?? 0);
        break;
      case "2fa_required":
        setShow2FA(true);
        setPendingCredentialId(last.credentialId || null);
        setStatus("Verification code required.");
        break;
      case "done":
        setStatus("Extraction complete");
        setDone(true);
        setRunning(false);
        if (counts.totalFollowers !== undefined) setTotalFollowers(counts.totalFollowers);
        if (counts.invalidCount !== undefined) setInvalidCount(counts.invalidCount);
        if (counts.duplicateCount !== undefined) setDuplicateCount(counts.duplicateCount);
        if (counts.processedCount !== undefined) setProcessedCount(counts.processedCount);
        if (counts.totalCount !== undefined) setTotalCount(counts.totalCount);
        if (pollRef.current) clearInterval(pollRef.current);
        break;
      case "error":
        setError(last.error || "Unknown error");
        setRunning(false);
        if (pollRef.current) clearInterval(pollRef.current);
        break;
    }
  }, []);

  const startExtraction = useCallback(async () => {
    const list = usernames
      .split(/[\n,]+/)
      .map((u) => u.trim())
      .filter(Boolean);
    if (!list.length) return;

    setRunning(true);
    setError(null);
    setDone(false);
    setShow2FA(false);
    setFollowers([]);
    setTotalFollowers(0);
    setInvalidCount(0);
    setDuplicateCount(0);
    setProcessedCount(0);
    setTotalCount(list.length);
    setStatus("Starting...");

    const result = await startExtractionAction("", list);
    if (result.error) {
      setError(result.error);
      setRunning(false);
      return;
    }
    const runId = result.runId!;
    runIdRef.current = runId;

    pollRef.current = setInterval(() => poll(runId), 1500);
  }, [usernames, poll]);

  const submit2FA = useCallback(async () => {
    if (!pendingCredentialId || !verificationCode.trim()) return;
    setSubmitting2FA(true);
    const result = await resolve2FAAction(pendingCredentialId, verificationCode.trim());
    if (result.success) {
      setShow2FA(false);
      setVerificationCode("");
      setStatus("Verification code submitted — resuming...");
    } else {
      setError("Failed to submit verification code");
    }
    setSubmitting2FA(false);
  }, [pendingCredentialId, verificationCode]);

  const stopExtraction = useCallback(async () => {
    if (runIdRef.current) {
      await stopExtractionAction(runIdRef.current);
    }
    if (pollRef.current) clearInterval(pollRef.current);
    setRunning(false);
    setStatus("Stopped");
  }, []);

  const progress = totalCount > 0 ? Math.round((processedCount / totalCount) * 100) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-bold text-2xl tracking-tight">Instagram Extractor</h1>
        <p className="text-muted-foreground">Extract followers from Instagram profiles</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Target Profiles</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            placeholder="Enter usernames (one per line, or comma-separated)"
            value={usernames}
            onChange={(e) => setUsernames(e.target.value)}
            rows={5}
            disabled={running}
          />
          <div className="flex gap-2">
            <Button onClick={startExtraction} disabled={running || !usernames.trim()}>
              {running ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Extracting...</>
              ) : (
                "Start Extraction"
              )}
            </Button>
            {running && (
              <Button variant="destructive" onClick={stopExtraction}>Stop</Button>
            )}
          </div>
        </CardContent>
      </Card>

      {show2FA && (
        <Card className="border-amber-400">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-amber-600">
              <ShieldAlert className="h-5 w-5" /> Verification Code Required
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Instagram requires a verification code. Check your email or authenticator app.
            </p>
            <div className="flex items-end gap-2">
              <div className="space-y-1 flex-1">
                <Label htmlFor="2fa-code">Verification Code</Label>
                <Input
                  id="2fa-code"
                  value={verificationCode}
                  onChange={(e) => setVerificationCode(e.target.value)}
                  placeholder="000000"
                  maxLength={8}
                  disabled={submitting2FA}
                />
              </div>
              <Button onClick={submit2FA} disabled={submitting2FA || !verificationCode.trim()}>
                {submitting2FA ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Verifying...</>
                ) : (
                  "Submit"
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {(status || error || done) && !show2FA && (
        <Card>
          <CardHeader>
            <CardTitle>Progress</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {running && totalCount > 0 && (
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{processedCount} of {totalCount} profiles</span>
                  <span>{progress}%</span>
                </div>
                <Progress value={progress} className="h-2" />
              </div>
            )}

            {status && (
              <div className="flex items-center gap-2 text-sm">
                {running && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                <span>{status}</span>
              </div>
            )}
            {error && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex flex-wrap gap-3">
              <Badge variant="secondary" className="gap-1 text-sm">
                <Users className="h-3.5 w-3.5" />
                {totalFollowers} followers
              </Badge>
              <Badge variant="outline" className="gap-1 text-sm text-amber-600 border-amber-300">
                <Ban className="h-3.5 w-3.5" />
                {invalidCount} invalid
              </Badge>
              <Badge variant="outline" className="gap-1 text-sm text-muted-foreground">
                <AlertCircle className="h-3.5 w-3.5" />
                {duplicateCount} duplicates ignored
              </Badge>
              {done && (
                <Badge className="gap-1 text-sm bg-green-600">
                  <CheckCircle className="h-3.5 w-3.5" />
                  Complete
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {followers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Extracted Followers ({followers.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-64 rounded border p-2">
              <div className="space-y-1">
                {followers.map((f, i) => (
                  <div key={`${f.username}-${i}`} className="flex items-center gap-2.5 text-sm px-2 py-1.5 rounded hover:bg-muted/50">
                    {f.avatarUrl ? (
                      <img
                        src={f.avatarUrl}
                        alt=""
                        className="h-7 w-7 rounded-full object-cover shrink-0"
                      />
                    ) : (
                      <div className="h-7 w-7 rounded-full bg-muted shrink-0 flex items-center justify-center">
                        <Users className="h-3.5 w-3.5 text-muted-foreground" />
                      </div>
                    )}
                    <span>@{f.username}</span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
