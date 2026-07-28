"use client";

import { useCallback, useEffect, useState } from "react";

import { Download, Loader2, Search, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  exportFollowersCSVAction,
  exportFollowersCSVChunkAction,
  getAllDistinctSourceProfilesAction,
  getAllFollowersAction,
} from "@/server/instagram/actions";

interface FollowerRow {
  followerUsername: string;
  sourceProfileUsername: string;
  lastSeenAt: string;
}

export default function FollowersPage() {
  const [followers, setFollowers] = useState<FollowerRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sourceProfiles, setSourceProfiles] = useState<string[]>([]);
  const [filterProfile, setFilterProfile] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const pageSize = 100;

  const load = useCallback(async () => {
    setLoading(true);
    const src = filterProfile === "all" ? undefined : filterProfile;
    const res = await getAllFollowersAction(src, page, pageSize);
    setFollowers(
      res.followers.map((f) => ({
        followerUsername: f.followerUsername,
        sourceProfileUsername: f.sourceProfileUsername,
        lastSeenAt: f.lastSeenAt,
      })),
    );
    setTotal(res.total);
    setLoading(false);
  }, [filterProfile, page]);

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    getAllDistinctSourceProfilesAction()
      .then(setSourceProfiles)
      .catch(() => setSourceProfiles([]));
  }, []);

  const handleExport = async () => {
    const src = filterProfile === "all" ? undefined : filterProfile;
    const { total } = await exportFollowersCSVAction(src);
    const chunkSize = 50000;
    const totalPages = Math.ceil(total / chunkSize);
    const baseName = `followers${src ? `-${src}` : ""}`;
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
  };

  const filtered = followers.filter((f) =>
    search ? f.followerUsername.toLowerCase().includes(search.toLowerCase()) : true,
  );

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-6 p-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Scraped Followers
            <Badge variant="secondary" className="ml-2">
              {total} total
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filters */}
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
              value={filterProfile}
              onValueChange={(v) => {
                setFilterProfile(v);
                setPage(0);
              }}
            >
              <SelectTrigger className="h-9 w-48">
                <SelectValue placeholder="Source profile" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All profiles</SelectItem>
                {sourceProfiles.map((p) => (
                  <SelectItem key={p} value={p}>
                    @{p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download className="mr-1 h-4 w-4" />
              Export CSV
            </Button>
          </div>

          {/* Table */}
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground text-sm">No followers found</p>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Username</TableHead>
                    <TableHead>Source Profile</TableHead>
                    <TableHead>Last Seen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((f) => (
                    <TableRow key={`${f.sourceProfileUsername}-${f.followerUsername}`}>
                      <TableCell className="font-mono text-sm">{f.followerUsername}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">@{f.sourceProfileUsername}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {new Date(f.lastSeenAt).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Pagination */}
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
