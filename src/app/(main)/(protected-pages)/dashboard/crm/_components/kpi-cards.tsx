"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, TrendingDown, TrendingUp } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { getLeadStatsAction, type LeadStats } from "../actions";
import { Skeleton } from "@/components/ui/skeleton";

function TrendBadge({ value, prev }: { value: number; prev: number }) {
  const diff = value - prev;
  const pct = prev !== 0 ? Math.round((diff / prev) * 100) : 0;
  if (diff === 0) return null;
  const isUp = diff > 0;
  return (
    <Badge
      variant="outline"
      className={
        isUp
          ? "border-green-200 bg-green-500/10 text-green-700 dark:border-green-900/40 dark:bg-green-500/15 dark:text-green-300"
          : "border-destructive/20 bg-destructive/10 text-destructive"
      }
    >
      {isUp ? <TrendingUp className="size-3 mr-1" /> : <TrendingDown className="size-3 mr-1" />}
      {pct}%
    </Badge>
  );
}

export function KpiCards() {
  const [stats, setStats] = useState<LeadStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getLeadStatsAction()
      .then(setStats)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <section className="space-y-5">
        <div className="space-y-1">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-4 w-32" />
              </CardHeader>
              <CardContent className="space-y-2">
                <Skeleton className="h-8 w-20" />
                <Skeleton className="h-4 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    );
  }

  if (!stats) {
    return (
      <section className="space-y-5">
        <p className="text-muted-foreground">Unable to load pipeline stats.</p>
      </section>
    );
  }

  const cards = [
    {
      title: "Total Leads",
      value: stats.totalLeads,
      prev: stats.prevTotalLeads,
      format: (v: number) => v.toString(),
    },
    {
      title: "Qualified Leads",
      value: stats.qualifiedLeads,
      prev: stats.prevQualifiedLeads,
      format: (v: number) => v.toString(),
    },
    {
      title: "Avg. Lead Score",
      value: stats.averageScore ?? 0,
      prev: stats.prevAverageScore ?? 0,
      format: (v: number) => (stats.averageScore !== null ? `${v}/100` : "—"),
    },
    {
      title: "Conversion Rate",
      value: stats.conversionRate,
      prev: stats.prevConversionRate,
      format: (v: number) => `${v}%`,
    },
  ];

  return (
    <section className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-3xl tracking-tight">Pipeline Overview</h2>
        <p className="text-muted-foreground text-sm">
          Keep tabs on lead volume, quality, and conversion across your sales cycle.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <Card key={card.title}>
            <CardHeader>
              <CardDescription>{card.title}</CardDescription>
              <CardAction>
                <ArrowUpRight className="size-4" />
              </CardAction>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-center gap-3">
                <span className="text-3xl leading-none tracking-tight">
                  {card.format(card.value)}
                </span>
                <TrendBadge value={card.value} prev={card.prev} />
              </div>
              <p className="text-sm">
                <span className="font-medium text-foreground">{card.format(card.prev)}</span>{" "}
                <span className="text-muted-foreground">last month</span>
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}