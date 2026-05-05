"use client";

import { use, useEffect, useState } from "react";
import { fetchSandbox, fetchLogs } from "@/lib/api";
import type { LogEntry, SandboxInfo } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LogViewer } from "@/components/log-viewer";

export default function SandboxDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [info, setInfo] = useState<(SandboxInfo & { lastExecution: LogEntry | null }) | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [i, l] = await Promise.all([fetchSandbox(id), fetchLogs(id)]);
        setInfo(i);
        setLogs(l);
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, [id]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!info) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Sandbox {info.sandboxId}</h1>
      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-1">
          <p>Created: {new Date(info.createdAt).toLocaleString()}</p>
          <p>Last used: {new Date(info.lastUsedAt).toLocaleString()}</p>
          <p>Executions: {info.executionCount}</p>
        </CardContent>
      </Card>
      <LogViewer logs={logs} />
    </div>
  );
}
