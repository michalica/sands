"use client";

import { useEffect, useState } from "react";
import { fetchSandboxes, createEventsSocket } from "@/lib/api";
import type { SandboxInfo } from "@/lib/api";
import { SandboxTable } from "@/components/sandbox-table";

export default function SandboxesPage() {
  const [sandboxes, setSandboxes] = useState<SandboxInfo[]>([]);

  const refresh = async () => {
    const s = await fetchSandboxes();
    setSandboxes(s.sandboxes);
  };

  useEffect(() => {
    refresh();
    const ws = createEventsSocket(() => refresh());
    return () => ws.close();
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Sandboxes</h1>
      <SandboxTable sandboxes={sandboxes} onRefresh={refresh} />
    </div>
  );
}
