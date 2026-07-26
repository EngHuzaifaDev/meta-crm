"use client";

import { useCallback, useEffect, useState } from "react";

import { Clock, Loader2, LogOut, Play, Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface SessionInfo {
  savedAt: string;
  expiresAt?: string;
  userAgent?: string;
}

interface Credential {
  _id: string;
  instagramUsername: string;
  isActive: boolean;
  createdAt: string;
  session: SessionInfo | null;
}

function formatExpiry(expiresAt?: string): { label: string; variant: "default" | "secondary" | "destructive" } {
  if (!expiresAt) return { label: "No session", variant: "secondary" };
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return { label: "Expired", variant: "destructive" };
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return { label: `${Math.floor(diff / 60000)}m remaining`, variant: "destructive" };
  if (hours < 24) return { label: `${hours}h remaining`, variant: "default" };
  return { label: `${Math.floor(hours / 24)}d remaining`, variant: "default" };
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

  const [testingId, setTestingId] = useState<string | null>(null);

  const clearSession = async (id: string) => {
    try {
      await fetch(`/api/instagram/session?id=${id}`, { method: "DELETE" });
      await load();
    } catch {
      // ignore
    }
  };

  const testLogin = async (id: string) => {
    setTestingId(id);
    try {
      const res = await fetch("/api/instagram/test-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credentialId: id }),
      });
      const data = await res.json();
      if (data.needs2FA) {
        alert("2FA code required — test login cannot complete without 2FA. Run extraction with 2FA enabled.");
      } else if (data.success) {
        alert("Login successful! Session saved.");
        await load();
      } else {
        alert(`Login failed: ${data.error || data.message || "Unknown error"}`);
      }
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setTestingId(null);
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
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...</>
              ) : (
                <><Plus className="mr-2 h-4 w-4" /> Add Credential</>
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
              {creds.map((cred) => {
                const expiry = formatExpiry(cred.session?.expiresAt);
                return (
                  <div key={cred._id} className="flex items-center justify-between rounded border p-3">
                    <div className="flex items-center gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">@{cred.instagramUsername}</span>
                          <Badge variant={cred.isActive ? "default" : "secondary"}>
                            {cred.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          <Badge variant={expiry.variant} className="text-[10px] px-1.5 py-0">
                            {expiry.label}
                          </Badge>
                          {cred.session?.savedAt && (
                            <span>saved {new Date(cred.session.savedAt).toLocaleDateString()}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => testLogin(cred._id)}
                        disabled={testingId === cred._id}
                        title="Test login"
                      >
                        {testingId === cred._id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Play className="h-4 w-4 text-green-600" />
                        )}
                      </Button>
                      {cred.session && (
                        <Button variant="ghost" size="icon" onClick={() => clearSession(cred._id)} title="Clear session">
                          <LogOut className="h-4 w-4" />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" onClick={() => deleteCredential(cred._id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
