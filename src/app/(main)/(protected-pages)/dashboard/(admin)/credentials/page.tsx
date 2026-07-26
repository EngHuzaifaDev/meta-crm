"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { AlertCircle, Clock, Loader2, LogOut, Play, Plus, ShieldAlert, Trash2, X } from "lucide-react";

import {
  getCredentialsAction,
  addCredentialAction,
  deleteCredentialAction,
  clearSessionAction,
  startTestLoginAction,
  pollTestLoginAction,
  resolve2FAAction,
} from "@/server/instagram/actions";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface SessionInfo {
  savedAt: Date | string;
  expiresAt?: Date | string;
  userAgent?: string;
}

interface Credential {
  _id: string;
  instagramUsername: string;
  isActive: boolean;
  createdAt: Date | string;
  session: SessionInfo | null;
}

function formatExpiry(expiresAt?: Date | string): { label: string; variant: "default" | "secondary" | "destructive" } {
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
  const [testingId, setTestingId] = useState<string | null>(null);

  const [show2FA, setShow2FA] = useState(false);
  const [twoFACredentialId, setTwoFACredentialId] = useState<string | null>(null);
  const [twoFACode, setTwoFACode] = useState("");
  const [submitting2FA, setSubmitting2FA] = useState(false);
  const [twoFAError, setTwoFAError] = useState<string | null>(null);

  const [loginResult, setLoginResult] = useState<{ id: string; type: "success" | "error"; message: string } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const testRunIdRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    setCreds(await getCredentialsAction());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const addCredential = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) return;
    setSaving(true);
    const fd = new FormData();
    fd.set("instagramUsername", username.trim());
    fd.set("password", password);
    const result = await addCredentialAction(fd);
    if (result.success) {
      setUsername("");
      setPassword("");
      await load();
    }
    setSaving(false);
  };

  const deleteCredential = async (id: string) => {
    await deleteCredentialAction(id);
    await load();
  };

  const clearSession = async (id: string) => {
    await clearSessionAction(id);
    await load();
  };

  const testLogin = async (id: string) => {
    setTestingId(id);
    setLoginResult(null);
    const { runId } = await startTestLoginAction(id);
    if (!runId) { setTestingId(null); return; }
    testRunIdRef.current = runId;

    pollRef.current = setInterval(async () => {
      const state = await pollTestLoginAction(runId);
      if (!state) { clearInterval(pollRef.current!); setTestingId(null); return; }
      const last = state.lastEvent;
      if (!last) return;
      if (last.type === "2fa_required") {
        clearInterval(pollRef.current!);
        setTwoFACredentialId(id);
        setTwoFACode("");
        setTwoFAError(null);
        setShow2FA(true);
      } else if (last.type === "done") {
        clearInterval(pollRef.current!);
        setLoginResult({ id, type: "success", message: "Login successful — session saved" });
        await load();
      } else if (last.type === "error") {
        clearInterval(pollRef.current!);
        setLoginResult({ id, type: "error", message: last.error || "Login failed" });
      }
    }, 1000);
    setTestingId(null);
  };

  const submit2FA = async () => {
    if (!twoFACredentialId || !twoFACode.trim()) return;
    setSubmitting2FA(true);
    setTwoFAError(null);
    const resolved = await resolve2FAAction(twoFACredentialId, twoFACode.trim());
    if (resolved.success) {
      setShow2FA(false);
      setLoginResult({ id: twoFACredentialId, type: "success", message: "Code submitted — completing login..." });
      const runId = testRunIdRef.current;
      if (runId) {
        pollRef.current = setInterval(async () => {
          const state = await pollTestLoginAction(runId);
          if (!state) { clearInterval(pollRef.current!); return; }
          const last = state.lastEvent;
          if (!last) return;
          if (last.type === "done") {
            clearInterval(pollRef.current!);
            setLoginResult({ id: twoFACredentialId, type: "success", message: "Login successful — session saved" });
            await load();
          } else if (last.type === "error") {
            clearInterval(pollRef.current!);
            setLoginResult({ id: twoFACredentialId, type: "error", message: last.error || "Login failed" });
          }
        }, 1000);
      }
    } else {
      setTwoFAError("Failed to submit verification code");
    }
    setSubmitting2FA(false);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-bold text-2xl tracking-tight">Credentials</h1>
        <p className="text-muted-foreground">Manage Instagram accounts used for extraction (admin only)</p>
      </div>

      {loginResult && (
        <Card className={loginResult.type === "success" ? "border-green-500" : "border-destructive"}>
          <CardContent className="flex items-center justify-between p-4">
            <div className="flex items-center gap-2 text-sm">
              {loginResult.type === "success" ? (
                <AlertCircle className="h-4 w-4 text-green-600" />
              ) : (
                <AlertCircle className="h-4 w-4 text-destructive" />
              )}
              <span className={loginResult.type === "success" ? "text-green-700" : "text-destructive"}>
                {loginResult.message}
              </span>
            </div>
            <Button variant="ghost" size="icon" onClick={() => setLoginResult(null)}>
              <X className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      )}

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

      <Dialog open={show2FA} onOpenChange={(open) => { if (!open) setShow2FA(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-amber-500" /> Verification Code Required
            </DialogTitle>
            <DialogDescription>
              Instagram requires a verification code. Check your email or authenticator app.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label htmlFor="2fa-code">Verification Code</Label>
              <Input
                id="2fa-code"
                value={twoFACode}
                onChange={(e) => setTwoFACode(e.target.value)}
                placeholder="000000"
                maxLength={8}
                disabled={submitting2FA}
                autoFocus
              />
            </div>
            {twoFAError && (
              <p className="text-sm text-destructive">{twoFAError}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShow2FA(false)} disabled={submitting2FA}>
              Cancel
            </Button>
            <Button onClick={submit2FA} disabled={submitting2FA || !twoFACode.trim()}>
              {submitting2FA ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Verifying...</>
              ) : (
                "Submit"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
