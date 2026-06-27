"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PlayIcon,
  Loader2Icon,
  CheckCircle2Icon,
  XCircleIcon,
  CopyIcon,
  CheckIcon,
} from "lucide-react";
import {
  startLeadPipelineAction,
  getPipelineStatusAction,
  getLeadAction,
} from "../../actions";
import { toast } from "sonner";

// Helper to safely render content from strings or objects with { body }
function renderContent(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) {
    if ("body" in value) return String(value.body);
    return JSON.stringify(value);
  }
  return String(value);
}

// Copy-to-clipboard button component
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy text.");
    }
  };
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8"
      onClick={handleCopy}
      aria-label="Copy to clipboard"
    >
      {copied ? (
        <CheckIcon className="h-4 w-4 text-green-500" />
      ) : (
        <CopyIcon className="h-4 w-4" />
      )}
    </Button>
  );
}

function ChatMessage({
  label,
  content,
}: {
  label: string;
  content: string;
}) {
  return (
    <div className="space-y-1">
      <h4 className="text-sm font-medium text-muted-foreground">{label}</h4>
      <div className="group relative flex items-start gap-2">
        <div className="flex-1 rounded-lg border bg-muted/50 p-3 text-sm whitespace-pre-wrap">
          {content}
        </div>
        {/* 👇 Visible on mobile, hidden on desktop until hover */}
        <div className="mt-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
          <CopyButton text={content} />
        </div>
      </div>
    </div>
  );
}

type LeadData = {
  name: string;
  leadId: string;
  website?: string;
  industry?: string;
  numberOfEmployees?: number;
  description?: string;
  score?: number;
  summary?: string | { subject?: string; body: string };
  coldOutreach?: string | { subject?: string; body: string };
  nextStep?: string | { subject?: string; body: string };
  status?: string;
};

type PipelineStatus = {
  _id: string;
  leadId: string;
  status: string;
  progressCode: string;
  statusReport: string;
  error?: string;
} | any;

interface Props {
  lead: LeadData;
}

export function LeadAnalysis({ lead }: Props) {
  const [status, setStatus] = useState<PipelineStatus | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [leadData, setLeadData] = useState<LeadData>(lead);
  const [isPolling, setIsPolling] = useState(false);

  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isResultLoading, setIsResultLoading] = useState(false);

  // On mount, check if a pipeline already exists
  useEffect(() => {
    getPipelineStatusAction(lead.leadId)
      .then((existingStatus: any) => {
        if (existingStatus) {
          setStatus(existingStatus);
          if (
            existingStatus.status === "queued" ||
            existingStatus.status === "processing"
          ) {
            setIsPolling(true);
          } else if (existingStatus.status === "completed") {
            setIsResultLoading(true);
            getLeadAction(lead.leadId).then((updatedLead) => {
              if (updatedLead) {
                setLeadData({
                  ...leadData,
                  score: updatedLead.score,
                  summary: updatedLead.summary,
                  coldOutreach: updatedLead.coldOutreach,
                  nextStep: updatedLead.nextStep,
                  status: updatedLead.status,
                });
              }
              setIsResultLoading(false);
            });
          }
        }
      })
      .finally(() => setIsInitialLoading(false));
  }, [lead.leadId]);

  const handleStart = async () => {
    setIsStarting(true);
    try {
      const initialStatus = await startLeadPipelineAction(lead.leadId);
      setStatus(initialStatus);
      setIsPolling(true);
      toast.success("Analysis started!");
    } catch (error: any) {
      toast.error(error.message || "Failed to start analysis");
    } finally {
      setIsStarting(false);
    }
  };

  const pollStatus = useCallback(async () => {
    if (!isPolling) return;
    try {
      const newStatus = await getPipelineStatusAction(lead.leadId);
      if (newStatus) {
        setStatus(newStatus);
        if (newStatus.status === "completed" || newStatus.status === "failed") {
          setIsPolling(false);
          if (newStatus.status === "completed") {
            setIsResultLoading(true);
            const updatedLead = await getLeadAction(lead.leadId);
            if (updatedLead) {
              setLeadData({
                ...leadData,
                score: updatedLead.score,
                summary: updatedLead.summary,
                coldOutreach: updatedLead.coldOutreach,
                nextStep: updatedLead.nextStep,
                status: updatedLead.status,
              });
            }
            setIsResultLoading(false);
          }
        }
      }
    } catch (error) {
      console.error("Polling error:", error);
    }
  }, [isPolling, lead.leadId, leadData]);

  useEffect(() => {
    if (!isPolling) return;
    const interval = setInterval(pollStatus, 2000);
    return () => clearInterval(interval);
  }, [isPolling, pollStatus]);

  const progressValue = status
    ? status.progressCode === "queued"
      ? 10
      : status.progressCode === "scraping"
        ? 25
        : status.progressCode === "qualifying"
          ? 50
          : status.progressCode === "done"
            ? 100
            : status.status === "failed"
              ? 100
              : 0
    : 0;

  const isComplete = status?.status === "completed";
  const isFailed = status?.status === "failed";

  // Show skeleton on initial mount
  if (isInitialLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-8 w-32" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Start / Progress */}
      {!isComplete && !isFailed && (
        <div className="flex flex-col items-start gap-4">
          {status ? (
            <div className="w-full space-y-4">
              <div className="flex items-center gap-3">
                {progressValue === 100 ? (
                  <CheckCircle2Icon className="h-5 w-5 text-green-500" />
                ) : (
                  <Loader2Icon className="h-5 w-5 animate-spin text-muted-foreground" />
                )}
                <p className="font-medium text-sm">{status.statusReport}</p>
              </div>
              {progressValue < 100 && (
                <Progress value={progressValue} className="w-full" />
              )}
              {progressValue === 100 && (
                <p className="text-sm text-green-600 font-medium">
                  Complete! Loading results…
                </p>
              )}
            </div>
          ) : (
            <Button onClick={handleStart} disabled={isStarting}>
              {isStarting ? (
                <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <PlayIcon className="mr-2 h-4 w-4" />
              )}
              Start Analysis
            </Button>
          )}
        </div>
      )}

      {/* Completed – chat message style */}
      {isComplete && (
        <>
          {isResultLoading ? (
            <Card>
              <CardHeader>
                <Skeleton className="h-6 w-48" />
              </CardHeader>
              <CardContent className="space-y-4">
                <Skeleton className="h-8 w-24" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-3/4" />
              </CardContent>
            </Card>
          ) : leadData.score !== undefined ? (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <CheckCircle2Icon className="h-5 w-5 text-green-500" />
                  AI Evaluation Complete
                </CardTitle>
                <span className="text-2xl font-bold">{leadData.score}/100</span>
              </CardHeader>
              <CardContent className="space-y-6">
                {leadData.summary && (
                  <ChatMessage
                    label="Summary"
                    content={renderContent(leadData.summary)}
                  />
                )}
                {leadData.coldOutreach && (
                  <ChatMessage
                    label="Cold Outreach"
                    content={renderContent(leadData.coldOutreach)}
                  />
                )}
                {leadData.nextStep && (
                  <ChatMessage
                    label="Next Step"
                    content={renderContent(leadData.nextStep)}
                  />
                )}
              </CardContent>
            </Card>
          ) : null}
        </>
      )}

      {/* Failed */}
      {isFailed && (
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg text-destructive">
              <XCircleIcon className="h-5 w-5" />
              Analysis Failed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-destructive">
              {status?.error || "An unknown error occurred."}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}