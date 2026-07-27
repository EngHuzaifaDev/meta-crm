"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  AlertCircle,
  Ban,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Download,
  Loader2,
  Lock,
  ShieldAlert,
  Upload,
  Users,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import {
  startExtractionAction,
  pollExtractionAction,
  stopExtractionAction,
  resolve2FAAction,
  checkScrapedSourcesAction,
  getScrapedSourcesAction,
} from "@/server/instagram/actions";

interface FollowerEntry {
  username: string;
  avatarUrl?: string;
}

interface ProgressEvent {
  type: "status" | "follower" | "invalid" | "duplicate" | "skipped" | "private" | "done" | "error" | "2fa_required";
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

interface ScrapedSource {
  profileUsername: string;
  followerCount: number;
  profilePicUrl?: string;
  isPrivate?: boolean;
}

export default function ExtractorPage() {
  const [tags, setTags] = useState<string[]>([]);
  const [inputVal, setInputVal] = useState("");
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [followers, setFollowers] = useState<FollowerEntry[]>([]);
  const [totalFollowers, setTotalFollowers] = useState(0);
  const [invalidCount, setInvalidCount] = useState(0);
  const [privateCount, setPrivateCount] = useState(0);
  const [duplicateCount, setDuplicateCount] = useState(0);
  const [processedCount, setProcessedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [show2FA, setShow2FA] = useState(false);
  const [pendingCredentialId, setPendingCredentialId] = useState<string | null>(null);
  const [verificationCode, setVerificationCode] = useState("");
  const [submitting2FA, setSubmitting2FA] = useState(false);
  const [scrapedStatus, setScrapedStatus] = useState<Record<string, "scraped" | "private" | null>>({});
  const [scrapedSources, setScrapedSources] = useState<ScrapedSource[]>([]);
  const [scrapedSourcesTotal, setScrapedSourcesTotal] = useState(0);
  const [scrapedSourcesMore, setScrapedSourcesMore] = useState(false);
  const [showAllSources, setShowAllSources] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runIdRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  useEffect(() => {
    getScrapedSourcesAction().then((r) => {
      setScrapedSources(r.sources);
      setScrapedSourcesTotal(r.total);
      setScrapedSourcesMore(r.hasMore);
    });
  }, []);

  const validateTags = useCallback(async (newTags: string[]) => {
    if (!newTags.length) return;
    const result = await checkScrapedSourcesAction(newTags);
    setScrapedStatus((prev) => ({ ...prev, ...result }));
  }, []);

  const addTag = useCallback(
    (val: string) => {
      const trimmed = val.trim().toLowerCase().replace(/[^a-z0-9._]/g, "");
      if (!trimmed || tags.includes(trimmed)) return;
      const next = [...tags, trimmed];
      setTags(next);
      setInputVal("");
      validateTags(next);
    },
    [tags, validateTags],
  );

  const removeTag = useCallback((idx: number) => {
    const removed = tags[idx];
    setTags((prev) => prev.filter((_, i) => i !== idx));
    setScrapedStatus((prev) => {
      const next = { ...prev };
      delete next[removed];
      return next;
    });
  }, [tags]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === ",") {
        e.preventDefault();
        addTag(inputVal);
      }
      if (e.key === "Backspace" && !inputVal && tags.length > 0) {
        removeTag(tags.length - 1);
      }
    },
    [inputVal, tags, addTag, removeTag],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      e.preventDefault();
      const text = e.clipboardData.getData("text");
      const parts = text.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
      if (!parts.length) return;
      const next = [...tags];
      let added = 0;
      for (const p of parts) {
        const cleaned = p.toLowerCase().replace(/[^a-z0-9._]/g, "");
        if (cleaned && !next.includes(cleaned)) {
          next.push(cleaned);
          added++;
        }
      }
      if (added > 0) {
        setTags(next);
        setInputVal("");
        validateTags(next);
      }
    },
    [tags, validateTags],
  );

  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target?.result as string;
        if (!text) return;
        const lines = text.split(/[\n\r]+/).filter(Boolean);
        const keys = lines.flatMap((line) => line.split(",").map((s) => s.trim().replace(/^["']|["']$/g, ""))).filter(Boolean);
        const next = [...tags];
        let added = 0;
        for (const k of keys) {
          const cleaned = k.toLowerCase().replace(/[^a-z0-9._]/g, "");
          if (cleaned && !next.includes(cleaned)) {
            next.push(cleaned);
            added++;
          }
        }
        if (added > 0) {
          setTags(next);
          validateTags(next);
        }
      };
      reader.readAsText(file);
      e.target.value = "";
    },
    [tags, validateTags],
  );

  const downloadCSV = useCallback(() => {
    if (!tags.length) return;
    const csv = "username\n" + tags.map((t) => t).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "target-profiles.csv";
    a.click();
    URL.revokeObjectURL(url);
  }, [tags]);

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
    };

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
      case "private":
        setPrivateCount((prev) => prev + 1);
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
        getScrapedSourcesAction().then((r) => {
          setScrapedSources(r.sources);
          setScrapedSourcesTotal(r.total);
          setScrapedSourcesMore(r.hasMore);
        });
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
    if (!tags.length) return;

    const toScrape = tags.filter((t) => !scrapedStatus[t]);
    const discarded = tags.filter((t) => scrapedStatus[t] === "scraped").length;
    const privateDiscarded = tags.filter((t) => scrapedStatus[t] === "private").length;

    if (!toScrape.length) {
      setStatus("All profiles already scraped — nothing to extract");
      return;
    }

    setRunning(true);
    setError(null);
    setDone(false);
    setShow2FA(false);
    setFollowers([]);
    setTotalFollowers(0);
    setInvalidCount(0);
    setDuplicateCount(0);
    setProcessedCount(0);
    setTotalCount(toScrape.length);
    const parts: string[] = [];
    if (discarded > 0) parts.push(`${discarded} already scraped`);
    if (privateDiscarded > 0) parts.push(`${privateDiscarded} private`);
    setStatus(parts.length > 0 ? `Starting — ${parts.join(", ")} — skipped` : "Starting...");

    const result = await startExtractionAction("", toScrape);
    if (result.error) {
      setError(result.error);
      setRunning(false);
      return;
    }
    const runId = result.runId!;
    runIdRef.current = runId;

    pollRef.current = setInterval(() => poll(runId), 1500);
  }, [tags, scrapedStatus, poll]);

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

  const displaySources = showAllSources ? scrapedSources : scrapedSources.slice(0, 10);

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
          <div className="flex flex-wrap items-center gap-1.5 min-h-[42px] rounded-md border bg-transparent px-3 py-1.5 text-sm shadow-sm transition-colors focus-within:outline-none focus-within:ring-1 focus-within:ring-ring">
            {tags.map((t, i) => {
              const status = scrapedStatus[t];
              const isScraped = status === "scraped";
              const isPrivate = status === "private";
              return (
                <span
                  key={t}
                  data-status={status ?? ""}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary/50 px-2 py-0.5 text-xs font-medium data-[status=scraped]:border-amber-300 data-[status=scraped]:bg-amber-50 dark:data-[status=scraped]:bg-amber-950/30 data-[status=private]:border-violet-300 data-[status=private]:bg-violet-50 dark:data-[status=private]:bg-violet-950/30"
                >
                  <span className={isScraped ? "text-amber-600 dark:text-amber-400" : isPrivate ? "text-violet-600 dark:text-violet-400" : ""}>{t}</span>
                  {isScraped && <span className="text-[10px] text-amber-500 font-normal">scraped</span>}
                  {isPrivate && <Lock className="h-3 w-3 text-violet-500" />}
                  {!running && (
                    <button
                      type="button"
                      onClick={() => removeTag(i)}
                      className="ml-0.5 rounded-full p-0.5 hover:bg-muted transition-colors"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </span>
              );
            })}
            <input
              ref={inputRef}
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={tags.length === 0 ? "Type or paste usernames (comma-separated)" : "Add more..."}
              disabled={running}
              className="min-w-[120px] flex-1 border-0 bg-transparent p-0 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={startExtraction} disabled={running || tags.length === 0}>
              {running ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Extracting...</>
              ) : (
                "Start Extraction"
              )}
            </Button>
            {running && (
              <Button variant="destructive" onClick={stopExtraction}>Stop</Button>
            )}
            <div className="ml-auto flex gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleFileUpload}
                className="hidden"
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={running}>
                    <Upload className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Import CSV</TooltipContent>
              </Tooltip>
              {tags.length > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="sm" onClick={downloadCSV}>
                      <Download className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Download CSV</TooltipContent>
                </Tooltip>
              )}
            </div>
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
              <Badge variant="outline" className="gap-1 text-sm text-violet-600 border-violet-300 dark:text-violet-400 dark:border-violet-800">
                <Lock className="h-3.5 w-3.5" />
                {privateCount} private
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
                  <div
                    key={`${f.username}-${i}`}
                    className="flex items-center gap-2.5 text-sm px-2 py-1.5 rounded hover:bg-muted/50"
                  >
                    {f.avatarUrl ? (
                      <img src={f.avatarUrl} alt="" className="h-7 w-7 rounded-full object-cover shrink-0" />
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

      {scrapedSources.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Previously Scraped Sources ({scrapedSourcesTotal})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {displaySources.map((s) => (
                <div
                  key={s.profileUsername}
                  className="flex flex-col items-center gap-1.5 p-3 rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div className="relative">
                    {s.profilePicUrl ? (
                      <img src={s.profilePicUrl} alt="" className="h-14 w-14 rounded-full object-cover" />
                    ) : (
                      <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center">
                        {s.isPrivate ? (
                          <Lock className="h-5 w-5 text-violet-500" />
                        ) : (
                          <Users className="h-5 w-5 text-muted-foreground" />
                        )}
                      </div>
                    )}
                    {s.isPrivate ? (
                      <div className="absolute -bottom-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-violet-600 px-1 text-[10px] font-semibold text-white shadow-xs">
                        <Lock className="h-3 w-3" />
                      </div>
                    ) : (
                      <div className="absolute -bottom-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground shadow-xs">
                        {s.followerCount}
                      </div>
                    )}
                  </div>
                  <span className="text-xs font-medium text-center truncate max-w-full">
                    @{s.profileUsername}
                  </span>
                  {s.isPrivate && (
                    <span className="text-[10px] text-violet-500 font-medium">Private</span>
                  )}
                </div>
              ))}
            </div>
            {scrapedSourcesMore && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-3 w-full"
                onClick={() => setShowAllSources(!showAllSources)}
              >
                {showAllSources ? (
                  <><ChevronUp className="mr-1 h-4 w-4" /> Show less</>
                ) : (
                  <><ChevronDown className="mr-1 h-4 w-4" /> Show all {scrapedSourcesTotal}</>
                )}
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
