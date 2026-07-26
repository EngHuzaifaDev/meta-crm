"use client";

import { useCallback, useEffect, useState } from "react";

import { Loader2, Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Credential {
  _id: string;
  instagramUsername: string;
  isActive: boolean;
  createdAt: string;
}

export default function CredentialsPage() {
  const [creds, setCreds] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/instagram/credentials");
      if (res.ok) setCreds(await res.json());
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const addCredential = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/instagram/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instagramUsername: username.trim(), password }),
      });
      if (res.ok) {
        setUsername("");
        setPassword("");
        await load();
      }
    } finally {
      setSaving(false);
    }
  };

  const deleteCredential = async (id: string) => {
    try {
      await fetch(`/api/instagram/credentials?id=${id}`, { method: "DELETE" });
      await load();
    } catch {
      // ignore
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-bold text-2xl tracking-tight">Credentials</h1>
        <p className="text-muted-foreground">Manage Instagram accounts used for extraction (admin only)</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add Credential</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={addCredential} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Instagram Username</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="instagram_user"
                disabled={saving}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                disabled={saving}
              />
            </div>
            <Button type="submit" disabled={saving || !username.trim() || !password.trim()}>
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...
                </>
              ) : (
                <>
                  <Plus className="mr-2 h-4 w-4" /> Add Credential
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Saved Credentials</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading...
            </div>
          ) : creds.length === 0 ? (
            <p className="text-muted-foreground text-sm">No credentials added yet.</p>
          ) : (
            <div className="space-y-3">
              {creds.map((cred) => (
                <div key={cred._id} className="flex items-center justify-between rounded border p-3">
                  <div className="flex items-center gap-3">
                    <span className="font-medium">@{cred.instagramUsername}</span>
                    <Badge variant={cred.isActive ? "default" : "secondary"}>
                      {cred.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => deleteCredential(cred._id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
