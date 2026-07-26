"use client";

import { useCallback, useRef, useState } from "react";

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

interface ProgressEvent {
  type: "status" | "follower" | "invalid" | "duplicate" | "done" | "error" | "2fa_required";
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
  const [followers, setFollowers] = useState<string[]>([]);
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
  const abortRef = useRef<AbortController | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);

  const handleSSEStream = useCallback(async (
    response: Response,
    controller: AbortController,
  ) => {
    const reader = response.body?.getReader();
    if (!reader) {
      setError("No response stream");
      setRunning(false);
      return;
    }
    readerRef.current = reader;

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done: streamDone, value } = await reader.read();
      if (streamDone) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const event: ProgressEvent = JSON.parse(line.slice(6));

            switch (event.type) {
              case "status":
                setStatus(event.message || null);
                setProcessedCount(event.processedCount ?? 0);
                setTotalCount(event.totalCount ?? 0);
                break;
              case "follower":
                setFollowers((prev) => [...prev, event.followerUsername!]);
                setTotalFollowers(event.totalFollowers ?? 0);
                setDuplicateCount(event.duplicateCount ?? 0);
                setInvalidCount(event.invalidCount ?? 0);
                setProcessedCount(event.processedCount ?? 0);
                setTotalCount(event.totalCount ?? 0);
                break;
              case "invalid":
                setInvalidCount(event.invalidCount ?? 0);
                setProcessedCount(event.processedCount ?? 0);
                break;
              case "duplicate":
                setDuplicateCount(event.duplicateCount ?? 0);
                break;
              case "2fa_required":
                setShow2FA(true);
                setPendingCredentialId(event.credentialId || null);
                setStatus("Verification code required. Check your email or authenticator app.");
                break;
              case "done":
                setStatus("Extraction complete");
                setDone(true);
                setRunning(false);
                break;
              case "error":
                setError(event.error || "Unknown error");
                setRunning(false);
                break;
            }
          } catch {
            // skip malformed
          }
        }
      }
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

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/instagram/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usernames: list }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const err = await response.json();
        setError(err.error || "Request failed");
        setRunning(false);
        return;
      }

      await handleSSEStream(response, controller);
    } catch (err: any) {
      if (err.name !== "AbortError") {
        setError(err.message || "Connection error");
      }
    } finally {
      setRunning(false);
      readerRef.current = null;
    }
  }, [usernames, handleSSEStream]);

  const submit2FA = useCallback(async () => {
    if (!pendingCredentialId || !verificationCode.trim()) return;
    setSubmitting2FA(true);
    try {
      const res = await fetch("/api/instagram/verify-2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          credentialId: pendingCredentialId,
          code: verificationCode.trim(),
        }),
      });
      if (res.ok) {
        setShow2FA(false);
        setVerificationCode("");
        setStatus("Verification code submitted — resuming...");
      } else {
        const err = await res.json();
        setError(err.error || "Failed to submit code");
      }
    } catch {
      setError("Failed to submit verification code");
    } finally {
      setSubmitting2FA(false);
    }
  }, [pendingCredentialId, verificationCode]);

  const stopExtraction = useCallback(async () => {
    abortRef.current?.abort();
    readerRef.current?.cancel();
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
            <CardTitle>Extracted Followers ({followers.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-64 rounded border p-2">
              <div className="space-y-1">
                {followers.map((f, i) => (
                  <div key={`${f}-${i}`} className="flex items-center gap-2 text-sm">
                    <Users className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span>@{f}</span>
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
