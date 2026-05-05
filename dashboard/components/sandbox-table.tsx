"use client";

import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { destroySandbox, type SandboxInfo } from "@/lib/api";

export function SandboxTable({
  sandboxes,
  onRefresh,
}: {
  sandboxes: SandboxInfo[];
  onRefresh: () => void;
}) {
  async function handleDestroy(id: string) {
    await destroySandbox(id);
    onRefresh();
  }

  if (sandboxes.length === 0) {
    return <p className="text-sm text-muted-foreground">No sandboxes.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Sandbox ID</TableHead>
          <TableHead>Created</TableHead>
          <TableHead>Last used</TableHead>
          <TableHead>Executions</TableHead>
          <TableHead className="w-24" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {sandboxes.map((s) => (
          <TableRow key={s.sandboxId}>
            <TableCell className="font-mono text-xs">
              <Link href={`/sandboxes/${s.sandboxId}`} className="underline">
                {s.sandboxId.slice(0, 8)}…
              </Link>
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {new Date(s.createdAt).toLocaleString()}
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {new Date(s.lastUsedAt).toLocaleString()}
            </TableCell>
            <TableCell>{s.executionCount}</TableCell>
            <TableCell>
              <Button size="sm" variant="outline" onClick={() => handleDestroy(s.sandboxId)}>
                Destroy
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
