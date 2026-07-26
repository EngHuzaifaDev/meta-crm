"use client";

import { useCallback, useRef, useState } from "react";

import { AlertCircle, Ban, CheckCircle, Loader2, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";

interface ProgressEvent {
  type: "status" | "follower" | "invalid" | "duplicate" | "done" | "error";
  profileUsername?: string;
  message?: string;
  followerUsername?: string;
  count?: number;
  totalFollowers?: number;
  invalidCount?: number;
  duplicateCount?: number;
  error?: string;
}

export default function ExtractorPage() {
  const [usernames, setUsernames] = useState("");
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [followers, setFollowers] = useState<string[]>([]);
  const [totalFollowers, setTotalFollowers] = useState(0);
  const [invalidCount, setInvalidCount] = useState(0);
  const [duplicateCount, setDuplicateCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const startExtraction = useCallback(async () => {
    const list = usernames
      .split(/[\n,]+/)
      .map((u) => u.trim())
      .filter(Boolean);
    if (!list.length) return;

    setRunning(true);
    setError(null);
    setDone(false);
    setFollowers([]);
    setTotalFollowers(0);
    setInvalidCount(0);
    setDuplicateCount(0);
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

      const reader = response.body?.getReader();
      if (!reader) {
        setError("No response stream");
        setRunning(false);
        return;
      }

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
                  break;
                case "follower":
                  setFollowers((prev) => [...prev, event.followerUsername!]);
                  setTotalFollowers(event.totalFollowers ?? 0);
                  setDuplicateCount(event.duplicateCount ?? 0);
                  setInvalidCount(event.invalidCount ?? 0);
                  setStatus(`Extracting followers for @${event.profileUsername}... (${event.count} found)`);
                  break;
                case "invalid":
                  setInvalidCount(event.invalidCount ?? 0);
                  setStatus(`@${event.profileUsername} — not found`);
                  break;
                case "duplicate":
                  setDuplicateCount(event.duplicateCount ?? 0);
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
    } catch (err: any) {
      if (err.name !== "AbortError") {
        setError(err.message || "Connection error");
      }
    } finally {
      setRunning(false);
    }
  }, [usernames]);

  const stopExtraction = useCallback(() => {
    abortRef.current?.abort();
    setRunning(false);
    setStatus("Stopped");
  }, []);

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
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Extracting...
                </>
              ) : (
                "Start Extraction"
              )}
            </Button>
            {running && (
              <Button variant="destructive" onClick={stopExtraction}>
                Stop
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {(status || error || done) && (
        <Card>
          <CardHeader>
            <CardTitle>Progress</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {status && (
              <div className="flex items-center gap-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span>{status}</span>
              </div>
            )}
            {error && (
              <div className="flex items-center gap-2 text-destructive text-sm">
                <AlertCircle className="h-4 w-4" />
                <span>{error}</span>
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
              <Badge variant="outline" className="gap-1 text-muted-foreground text-sm">
                <AlertCircle className="h-3.5 w-3.5" />
                {duplicateCount} duplicates ignored
              </Badge>
              {done && (
                <Badge variant="default" className="gap-1 bg-green-600 text-sm">
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
                    <Users className="h-3 w-3 shrink-0 text-muted-foreground" />
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
