"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { LogEntry } from "@/lib/api";

export function LogViewer({ logs }: { logs: LogEntry[] }) {
  if (logs.length === 0) {
    return <p className="text-sm text-muted-foreground">No execution logs yet.</p>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Executions ({logs.length})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {logs.map((log) => (
          <div key={log.executionId} className="rounded border p-3 text-xs space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-mono">{log.executionId.slice(0, 8)}…</span>
              <span className="text-muted-foreground">{new Date(log.timestamp).toLocaleString()}</span>
            </div>
            <pre className="rounded bg-muted p-2 overflow-x-auto"><code>{log.code}</code></pre>
            <div className="grid grid-cols-2 gap-2">
              {log.result.stdout && (
                <pre className="rounded bg-muted p-2 overflow-x-auto"><code>{log.result.stdout}</code></pre>
              )}
              {log.result.stderr && (
                <pre className="rounded bg-destructive/10 p-2 overflow-x-auto"><code>{log.result.stderr}</code></pre>
              )}
            </div>
            <div className="text-muted-foreground">
              exit {log.result.exitCode} · {log.result.durationMs}ms
              {log.result.timedOut && " · timed out"}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
