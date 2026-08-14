"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  BadgeCheck,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  Loader2,
  Lock,
  MessageSquare,
  Search,
  Users,
} from "lucide-react";

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
  getHarvestedProfilesAction,
  getHarvestSourcesAction,
  getScrapedSourcesAction,
} from "@/server/instagram/actions";

interface SourceProfile {
  profileUsername: string;
  followerCount: number;
  profilePicUrl?: string;
  isPrivate?: boolean;
  isInvalid?: boolean;
  lastScrapedAt?: Date | string | null;
}

interface HarvestedProfile {
  username: string;
  fullName: string | null;
  avatarUrl: string | null;
  sourceKey: string;
  shortcode: string;
  isVerified: boolean;
  isPrivate: boolean;
  lastSeenAt: string;
}

interface HarvestSource {
  sourceKey: string;
  profileCount: number;
}

type SortKey = "fresh" | "followers" | "followers-asc";

const PAGE_STEP = 30;
const HARVEST_PAGE_SIZE = 100;

const TIERS = [
  { key: "1m", label: "1M+ followers", min: 1_000_000 },
  { key: "100k", label: "100K+ followers", min: 100_000 },
  { key: "10k", label: "10K+ followers", min: 10_000 },
  { key: "1k", label: "1K+ followers", min: 1_000 },
  { key: "rest", label: "Under 1K", min: 0 },
] as const;

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

function Hero({ total, targetM }: { total: number; targetM: number }) {
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
          <p className="font-medium text-muted-foreground text-xs uppercase tracking-widest">
            Total followers collected
          </p>
          <h1 className="animate-hyper-shift bg-[length:200%_auto] bg-gradient-to-r from-emerald-500 via-sky-500 to-violet-500 bg-clip-text py-1 font-extrabold text-6xl text-transparent tabular-nums md:text-7xl">
            {display.toLocaleString()}
          </h1>
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
      </CardContent>
    </Card>
  );
}

export default function FollowersPage() {
  const [profiles, setProfiles] = useState<SourceProfile[]>([]);
  const [total, setTotal] = useState(0);
  const [cumulativeFollowers, setCumulativeFollowers] = useState(0);
  const [limit, setLimit] = useState(PAGE_STEP);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("fresh");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [collectiveExport, setCollective] = useState(false);
  const [targetM, setTargetM] = useState(16);

  const [harvested, setHarvested] = useState<HarvestedProfile[]>([]);
  const [harvestTotal, setHarvestTotal] = useState(0);
  const [harvestSources, setHarvestSources] = useState<HarvestSource[]>([]);
  const [harvestSource, setHarvestSource] = useState("all");
  const [harvestSearch, setHarvestSearch] = useState("");
  const [harvestPage, setHarvestPage] = useState(0);
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
    exportFollowersCSVAction()
      .then(({ total: t }) => setCumulativeFollowers(t))
      .catch(() => undefined);
  }, []);

  const loadHarvested = useCallback(async (nextPage: number, append: boolean, src: string) => {
    setHarvestLoading(true);
    const sourceKey = src === "all" ? undefined : src;
    const res = await getHarvestedProfilesAction({ sourceKey }, nextPage, HARVEST_PAGE_SIZE);
    const rows: HarvestedProfile[] = res.profiles.map((p) => ({
      username: p.username,
      fullName: p.fullName,
      avatarUrl: p.avatarUrl,
      sourceKey: p.sourceKey,
      shortcode: p.shortcode,
      isVerified: p.isVerified,
      isPrivate: p.isPrivate,
      lastSeenAt: p.lastSeenAt,
    }));
    setHarvested((prev) => (append ? [...prev, ...rows] : rows));
    setHarvestTotal(res.total);
    setHarvestLoading(false);
  }, []);

  useEffect(() => {
    loadHarvested(0, false, harvestSource).catch(() => setHarvestLoading(false));
  }, [loadHarvested, harvestSource]);

  useEffect(() => {
    getHarvestSourcesAction(50)
      .then(setHarvestSources)
      .catch(() => setHarvestSources([]));
  }, []);

  const handleExport = async () => {
    const src = collectiveExport ? undefined : profiles[0]?.profileUsername;
    if (!collectiveExport && !src) return;
    setExporting(true);
    try {
      const { total: t } = await exportFollowersCSVAction(src);
      const chunkSize = 50000;
      const totalPages = Math.ceil(t / chunkSize);
      const baseName = collectiveExport ? "followers-all" : `followers-${src}`;
      for (let page = 0; page < totalPages; page++) {
        const { csv } = await exportFollowersCSVChunkAction(src, page, chunkSize);
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

  const filtered = useMemo(
    () => profiles.filter((p) => (search ? p.profileUsername.toLowerCase().includes(search.toLowerCase()) : true)),
    [profiles, search],
  );

  const groups = useMemo(() => {
    return TIERS.map((tier, i) => {
      const upper = TIERS[i - 1]?.min ?? Infinity;
      const members = filtered.filter((p) => p.followerCount >= tier.min && p.followerCount < upper);
      return {
        tier,
        members,
        cumulative: members.reduce((s, p) => s + p.followerCount, 0),
      };
    }).filter((g) => g.members.length > 0);
  }, [filtered]);

  const toggleTier = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const filteredHarvested = useMemo(
    () =>
      harvested.filter((p) => (harvestSearch ? p.username.toLowerCase().includes(harvestSearch.toLowerCase()) : true)),
    [harvested, harvestSearch],
  );

  return (
    <div className="space-y-6 p-6">
      <Hero total={cumulativeFollowers} targetM={targetM} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Profiles
            <Badge variant="secondary" className="ml-2">
              {total} profiles
            </Badge>
            <Badge variant="outline" className="ml-1">
              {cumulativeFollowers.toLocaleString()} followers collected
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
            <Button variant="outline" onClick={handleExport} disabled={exporting}>
              {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              Export CSV
            </Button>
          </div>

          {loading && profiles.length === 0 ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-12 text-center text-muted-foreground text-sm">No profiles found</p>
          ) : (
            <div className="space-y-6">
              {groups.map(({ tier, members, cumulative }) => {
                const isCollapsed = collapsed.has(tier.key);
                return (
                  <section key={tier.key} className="space-y-2.5">
                    <button
                      type="button"
                      onClick={() => toggleTier(tier.key)}
                      className="flex w-full items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-left transition-colors hover:bg-muted"
                    >
                      {isCollapsed ? (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className="font-medium text-sm">{tier.label}</span>
                      <Badge variant="secondary" className="text-xs">
                        {members.length} profile{members.length !== 1 ? "s" : ""}
                      </Badge>
                      <span className="ml-auto text-muted-foreground text-xs">
                        {cumulative.toLocaleString()} followers
                      </span>
                    </button>
                    {!isCollapsed && (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {members.map((p) => (
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
                  </section>
                );
              })}
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
              {harvestTotal} profiles
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search username..."
                value={harvestSearch}
                onChange={(e) => setHarvestSearch(e.target.value)}
                className="h-9 w-56"
              />
            </div>
            <Select
              value={harvestSource}
              onValueChange={(v) => {
                setHarvestSource(v);
                setHarvestPage(0);
              }}
            >
              <SelectTrigger className="h-9 w-52">
                <SelectValue placeholder="Source" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                {harvestSources.map((s) => (
                  <SelectItem key={s.sourceKey} value={s.sourceKey}>
                    {s.sourceKey} ({s.profileCount})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {harvestLoading && harvested.length === 0 ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredHarvested.length === 0 ? (
            <p className="py-12 text-center text-muted-foreground text-sm">No harvested profiles found</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filteredHarvested.map((p) => (
                <div
                  key={`${p.shortcode}-${p.username}`}
                  className="group flex items-center gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-accent/40"
                >
                  <a
                    href={`https://www.instagram.com/${p.username}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-w-0 flex-1 items-center gap-3"
                  >
                    <Avatar avatarUrl={p.avatarUrl} username={p.username} />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 truncate font-medium text-sm">
                        @{p.username}
                        {p.isVerified && <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-sky-500" />}
                        {p.isPrivate && <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                      </p>
                      <p className="truncate text-muted-foreground text-xs">{p.fullName ?? "—"}</p>
                      <p className="truncate text-[10px] text-muted-foreground">
                        from {p.sourceKey} &middot; seen {new Date(p.lastSeenAt).toLocaleDateString()}
                      </p>
                    </div>
                  </a>
                  <a
                    href={`https://www.instagram.com/p/${p.shortcode}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0"
                  >
                    <ExternalLink className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </a>
                </div>
              ))}
            </div>
          )}

          {harvestTotal > harvested.length && (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                onClick={() => {
                  const next = harvestPage + 1;
                  setHarvestPage(next);
                  loadHarvested(next, true, harvestSource).catch(() => undefined);
                }}
                disabled={harvestLoading}
              >
                {harvestLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Load more
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
