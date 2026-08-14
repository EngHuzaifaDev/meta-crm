"use client";

import { useCallback, useEffect, useState } from "react";

import { Download, Loader2, MessageSquare, Search, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  exportHarvestCSVAction,
  exportHarvestCSVChunkAction,
  getHarvestedProfilesAction,
  getHarvestSourcesAction,
} from "@/server/instagram/actions";

interface HarvestRow {
  username: string;
  fullName: string | null;
  sourceKey: string;
  shortcode: string;
  isVerified: boolean;
  lastSeenAt: string;
}

interface HarvestSource {
  sourceKey: string;
  profileCount: number;
  lastHarvestedAt: string;
}

export default function HarvestedProfilesPage() {
  const [profiles, setProfiles] = useState<HarvestRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sources, setSources] = useState<HarvestSource[]>([]);
  const [filterSource, setFilterSource] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const pageSize = 100;

  const load = useCallback(async () => {
    setLoading(true);
    const sourceKey = filterSource === "all" ? undefined : filterSource;
    const res = await getHarvestedProfilesAction({ sourceKey }, page, pageSize);
    setProfiles(
      res.profiles.map((p) => ({
        username: p.username,
        fullName: p.fullName,
        sourceKey: p.sourceKey,
        shortcode: p.shortcode,
        isVerified: p.isVerified,
        lastSeenAt: p.lastSeenAt,
      })),
    );
    setTotal(res.total);
    setLoading(false);
  }, [filterSource, page]);

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    getHarvestSourcesAction(50)
      .then(setSources)
      .catch(() => setSources([]));
  }, []);

  const handleExport = async () => {
    const sourceKey = filterSource === "all" ? undefined : filterSource;
    const { total: t } = await exportHarvestCSVAction({ sourceKey });
    const chunkSize = 50000;
    const totalPages = Math.ceil(t / chunkSize);
    const baseName = `harvested${sourceKey ? `-${sourceKey}` : ""}`;
    for (let p = 0; p < totalPages; p++) {
      const { csv } = await exportHarvestCSVChunkAction({ sourceKey }, p, chunkSize);
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${baseName}-part-${p + 1}-of-${totalPages}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const filtered = profiles.filter((p) => (search ? p.username.toLowerCase().includes(search.toLowerCase()) : true));

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-6 p-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Harvested Profiles
            <Badge variant="secondary" className="ml-2">
              {total} total
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search username..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 w-48"
              />
            </div>
            <Select
              value={filterSource}
              onValueChange={(v) => {
                setFilterSource(v);
                setPage(0);
              }}
            >
              <SelectTrigger className="h-9 w-56">
                <SelectValue placeholder="Source account" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                {sources.map((s) => (
                  <SelectItem key={s.sourceKey} value={s.sourceKey}>
                    {s.sourceKey} ({s.profileCount})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download className="mr-1 h-4 w-4" />
              Export CSV
            </Button>
          </div>

          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground text-sm">No harvested profiles found</p>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Username</TableHead>
                    <TableHead>Full Name</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Post</TableHead>
                    <TableHead>Last Seen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((p) => (
                    <TableRow key={`${p.shortcode}-${p.username}`}>
                      <TableCell className="font-mono text-sm">
                        <span className="inline-flex items-center gap-1">
                          {p.isVerified && <Users className="h-3 w-3 text-sky-500" />}
                          {p.username}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">{p.fullName ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{p.sourceKey}</TableCell>
                      <TableCell className="font-mono text-muted-foreground text-xs">{p.shortcode}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {new Date(p.lastSeenAt).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 text-sm">
              <Button variant="outline" size="sm" disabled={page <= 0} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <span className="text-muted-foreground">
                Page {page + 1} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
