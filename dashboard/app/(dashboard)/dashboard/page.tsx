"use client";

import { useEffect, useState } from "react";
import { StatsCards } from "@/components/stats-cards";
import { SandboxTable } from "@/components/sandbox-table";
import { EventIndicator } from "@/components/event-indicator";
import { fetchMetrics, fetchSandboxes, createEventsSocket } from "@/lib/api";
import type { Metrics, SandboxInfo, SandboxEvent } from "@/lib/api";

export default function OverviewPage() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [sandboxes, setSandboxes] = useState<SandboxInfo[]>([]);
  const [lastEvent, setLastEvent] = useState<SandboxEvent | null>(null);

  const refresh = async () => {
    const [m, s] = await Promise.all([fetchMetrics(), fetchSandboxes()]);
    setMetrics(m);
    setSandboxes(s.sandboxes);
  };

  useEffect(() => {
    const load = async () => {
      await refresh();
    };

    void load();
    const ws = createEventsSocket((event) => {
      setLastEvent(event);
      void refresh();
    });
    return () => ws.close();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Overview</h1>
        <EventIndicator lastEvent={lastEvent} />
      </div>
      <StatsCards metrics={metrics} />
      <div>
        <h2 className="mb-3 text-lg font-semibold">Active Sandboxes</h2>
        <SandboxTable sandboxes={sandboxes} onRefresh={refresh} />
      </div>
    </div>
  );
}
