"use client";

import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface ApiKeyRow {
  id: string;
  name: string | null;
  start: string | null;
  createdAt: string | Date;
  enabled: boolean;
  expiresAt: string | Date | null;
}

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    const res = await authClient.apiKey.list();
    setLoading(false);
    if (res.error) {
      setError(res.error.message ?? "Failed to load keys");
      return;
    }
    const data = res.data as unknown;
    const list: ApiKeyRow[] = Array.isArray(data)
      ? (data as ApiKeyRow[])
      : Array.isArray((data as { apiKeys?: ApiKeyRow[] })?.apiKeys)
        ? (data as { apiKeys: ApiKeyRow[] }).apiKeys
        : [];
    setKeys(list);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    const res = await authClient.apiKey.create({ name: name || "default" });
    setCreating(false);
    if (res.error) {
      setError(res.error.message ?? "Failed to create key");
      return;
    }
    setNewKey((res.data as { key: string }).key);
    setName("");
    refresh();
  }

  async function onRevoke(id: string) {
    const res = await authClient.apiKey.delete({ keyId: id });
    if (res.error) {
      setError(res.error.message ?? "Failed to revoke");
      return;
    }
    refresh();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">API Keys</h1>
        <p className="text-sm text-muted-foreground">
          Use these to authenticate against the sandbox API.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Create a new key</CardTitle>
          <CardDescription>Give it a label so you remember where it&apos;s used.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onCreate} className="flex gap-2">
            <Input
              placeholder="Label (e.g. production-server)"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Button type="submit" disabled={creating}>
              {creating ? "Creating…" : "Create"}
            </Button>
          </form>
          {newKey && (
            <div className="mt-4 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
              <p className="font-medium mb-2">
                Copy this key now — it won&apos;t be shown again.
              </p>
              <code className="block break-all rounded bg-background p-2 font-mono text-xs">
                {newKey}
              </code>
              <Button
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={() => setNewKey(null)}
              >
                I&apos;ve saved it
              </Button>
            </div>
          )}
          {error && <p className="text-sm text-destructive mt-2">{error}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your keys</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : keys.length === 0 ? (
            <p className="text-sm text-muted-foreground">No keys yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Prefix</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((k) => (
                  <TableRow key={k.id}>
                    <TableCell>{k.name ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {k.start ? `${k.start}…` : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(k.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell>{k.enabled ? "Active" : "Disabled"}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="outline" onClick={() => onRevoke(k.id)}>
                        Revoke
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
