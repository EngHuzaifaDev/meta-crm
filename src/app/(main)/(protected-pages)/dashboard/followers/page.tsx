"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Download, ExternalLink, Loader2, Lock, MessageSquare, Search, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getCollectiveExport, getFollowerTargetM } from "@/lib/dev-settings";
import {
  exportFollowersCSVAction,
  exportFollowersCSVChunkAction,
  getHarvestSourcesAction,
  getScrapedSourcesAction,
  getUniqueProfilesCountAction,
} from "@/server/instagram/actions";

interface SourceProfile {
  profileUsername: string;
  followerCount: number;
  profilePicUrl?: string;
  isPrivate?: boolean;
  isInvalid?: boolean;
  lastScrapedAt?: Date | string | null;
}

interface HarvestSource {
  sourceKey: string;
  profileCount: number;
  lastHarvestedAt?: string;
}

type SortKey = "fresh" | "followers" | "followers-asc";

const PAGE_STEP = 30;

function formatM(millions: number): string {
  return `${millions}M`;
}

function Avatar({ avatarUrl, username }: { avatarUrl?: string | null; username: string }) {
  if (avatarUrl) {
    return <img src={avatarUrl} alt={`@${username}`} className="h-14 w-14 rounded-full object-cover" />;
  }
  return (
    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted font-semibold text-lg text-muted-foreground uppercase">
      {username.slice(0, 1)}
    </div>
  );
}

function Hero({
  total,
  followersTotal,
  harvestedTotal,
  duplicates,
  targetM,
  exporting,
  onExport,
}: {
  total: number;
  followersTotal: number;
  harvestedTotal: number;
  duplicates: number;
  targetM: number;
  exporting: boolean;
  onExport: () => void;
}) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (total <= 0) return;
    const duration = 1000;
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - (1 - p) ** 3;
      setDisplay(Math.round(total * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [total]);

  const target = targetM * 1_000_000;
  const percent = target > 0 ? (total / target) * 100 : 0;
  const reached = percent >= 100;

  return (
    <Card className="overflow-hidden border-primary/20 bg-gradient-to-b from-primary/5 to-transparent">
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <div className="animate-counter-pop">
          <p className="font-medium text-muted-foreground text-xs uppercase tracking-widest">Profiles extracted</p>
          <h1 className="animate-hyper-shift bg-[length:200%_auto] bg-gradient-to-r from-emerald-500 via-sky-500 to-violet-500 bg-clip-text py-1 font-extrabold text-6xl text-transparent tabular-nums md:text-7xl">
            {display.toLocaleString()}
          </h1>
          <p className="mt-1 text-muted-foreground text-sm">
            {followersTotal.toLocaleString()} followers + {harvestedTotal.toLocaleString()} commenters
            {duplicates > 0 && (
              <span className="text-muted-foreground/60"> ({duplicates.toLocaleString()} duplicates)</span>
            )}
          </p>
          <p className="mt-1 font-medium text-sm">
            {reached ? (
              <span className="text-emerald-600 dark:text-emerald-400">Target reached — keep going!</span>
            ) : (
              <span className="text-muted-foreground">
                {percent.toFixed(1)}% of {formatM(targetM)} target
              </span>
            )}
          </p>
        </div>
        <div className="w-full max-w-md space-y-1.5">
          <Progress value={Math.min(100, percent)} className="h-2.5" />
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>0</span>
            <span>{formatM(targetM)}</span>
          </div>
        </div>
        <Button variant="outline" onClick={onExport} disabled={exporting}>
          {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
          Export CSV
        </Button>
      </CardContent>
    </Card>
  );
}

export default function FollowersPage() {
  const [profiles, setProfiles] = useState<SourceProfile[]>([]);
  const [total, setTotal] = useState(0);
  const [uniqueStats, setUniqueStats] = useState({ followers: 0, harvested: 0, duplicates: 0, unique: 0 });
  const [limit, setLimit] = useState(PAGE_STEP);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("fresh");
  const [collectiveExport, setCollective] = useState(false);
  const [targetM, setTargetM] = useState(16);

  const [harvestSources, setHarvestSources] = useState<HarvestSource[]>([]);
  const [harvestLoading, setHarvestLoading] = useState(true);

  useEffect(() => {
    setCollective(getCollectiveExport());
    setTargetM(getFollowerTargetM());
  }, []);

  const load = useCallback(async (nextLimit: number, nextSort: SortKey) => {
    setLoading(true);
    const res = await getScrapedSourcesAction(nextLimit, nextSort);
    setProfiles(res.sources);
    setTotal(res.total);
    setHasMore(res.hasMore);
    setLoading(false);
  }, []);

  useEffect(() => {
    load(limit, sort).catch(() => setLoading(false));
  }, [load, limit, sort]);

  useEffect(() => {
    getUniqueProfilesCountAction()
      .then(setUniqueStats)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    getHarvestSourcesAction(50)
      .then((sources) => {
        setHarvestSources(sources);
        setHarvestLoading(false);
      })
      .catch(() => setHarvestLoading(false));
  }, []);

  const _harvestTotal = harvestSources.reduce((s, x) => s + x.profileCount, 0);

  const handleExport = async () => {
    const src = collectiveExport ? undefined : profiles[0]?.profileUsername;
    if (!collectiveExport && !src) return;
    setExporting(true);
    try {
      const { total: t } = await exportFollowersCSVAction(src, collectiveExport);
      const chunkSize = 50000;
      const totalPages = Math.ceil(t / chunkSize);
      const baseName = collectiveExport ? "followers-all" : `followers-${src}`;
      for (let page = 0; page < totalPages; page++) {
        const { csv } = await exportFollowersCSVChunkAction(src, page, chunkSize, collectiveExport);
        const blob = new Blob([csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${baseName}-part-${page + 1}-of-${totalPages}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } finally {
      setExporting(false);
    }
  };

  const sortedProfiles = useMemo(() => {
    const list = profiles.filter((p) =>
      search ? p.profileUsername.toLowerCase().includes(search.toLowerCase()) : true,
    );
    if (sort === "followers") list.sort((a, b) => b.followerCount - a.followerCount);
    else if (sort === "followers-asc") list.sort((a, b) => a.followerCount - b.followerCount);
    else list.sort((a, b) => String(b.lastScrapedAt ?? "").localeCompare(String(a.lastScrapedAt ?? "")));
    return list;
  }, [profiles, search, sort]);

  return (
    <div className="space-y-6 p-6">
      <Hero
        total={uniqueStats.unique}
        followersTotal={uniqueStats.followers}
        harvestedTotal={uniqueStats.harvested}
        duplicates={uniqueStats.duplicates}
        targetM={targetM}
        exporting={exporting}
        onExport={handleExport}
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Profiles
            <Badge variant="secondary" className="ml-2">
              {total} profiles
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search profile..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 w-56"
              />
            </div>
            <Select
              value={sort}
              onValueChange={(v) => {
                setSort(v as SortKey);
                setLimit(PAGE_STEP);
              }}
            >
              <SelectTrigger className="h-9 w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fresh">Recently extracted</SelectItem>
                <SelectItem value="followers">Followers: high to low</SelectItem>
                <SelectItem value="followers-asc">Followers: low to high</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {loading && profiles.length === 0 ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : sortedProfiles.length === 0 ? (
            <p className="py-12 text-center text-muted-foreground text-sm">No profiles found</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {sortedProfiles.map((p) => (
                <div
                  key={p.profileUsername}
                  className="group flex items-center gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-accent/40"
                >
                  <a
                    href={`https://www.instagram.com/${p.profileUsername}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-w-0 flex-1 items-center gap-3"
                  >
                    <Avatar avatarUrl={p.profilePicUrl} username={p.profileUsername} />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 truncate font-medium text-sm">
                        @{p.profileUsername}
                        {p.isPrivate && <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                      </p>
                      <p className="flex items-center gap-1 text-muted-foreground text-xs">
                        <Users className="h-3.5 w-3.5" />
                        {p.followerCount.toLocaleString()} followers
                      </p>
                      {p.lastScrapedAt && (
                        <p className="text-[10px] text-muted-foreground">
                          Scraped {new Date(p.lastScrapedAt).toLocaleDateString()}
                        </p>
                      )}
                      {p.isInvalid && (
                        <Badge variant="destructive" className="mt-1 text-[10px]">
                          Invalid
                        </Badge>
                      )}
                    </div>
                  </a>
                  <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </div>
              ))}
            </div>
          )}

          {hasMore && !search && (
            <div className="flex justify-center pt-2">
              <Button variant="outline" onClick={() => setLimit((l) => l + PAGE_STEP)} disabled={loading}>
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Load more
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Harvested from Comments
            <Badge variant="secondary" className="ml-2">
              {harvestSources.length} source{harvestSources.length !== 1 ? "s" : ""}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {harvestLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : harvestSources.length === 0 ? (
            <p className="py-12 text-center text-muted-foreground text-sm">No harvested sources found</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {harvestSources.map((s) => {
                const isMedia = s.sourceKey.startsWith("media_");
                const href = isMedia
                  ? `https://www.instagram.com/p/${s.sourceKey.slice(6)}`
                  : `https://www.instagram.com/${s.sourceKey}`;
                return (
                  <a
                    key={s.sourceKey}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-center gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-accent/40"
                  >
                    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted font-semibold text-lg text-muted-foreground uppercase">
                      {isMedia ? s.sourceKey.slice(-6) : s.sourceKey.slice(0, 1)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-sm">{isMedia ? s.sourceKey : `@${s.sourceKey}`}</p>
                      <p className="flex items-center gap-1 text-muted-foreground text-xs">
                        <Users className="h-3.5 w-3.5" />
                        {s.profileCount} profiles
                      </p>
                      {s.lastHarvestedAt && (
                        <p className="text-[10px] text-muted-foreground">
                          Harvested {new Date(s.lastHarvestedAt).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                    <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </a>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
