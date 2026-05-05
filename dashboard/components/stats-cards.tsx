"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Metrics } from "@/lib/api";

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function StatsCards({ metrics }: { metrics: Metrics | null }) {
  if (!metrics?.config) return null;

  const cards = [
    {
      title: "Active Sandboxes",
      value: `${metrics.activeSandboxes} / ${metrics.maxSandboxes || "∞"}`,
      description: "Currently running VMs",
    },
    {
      title: "Backend",
      value: metrics.backendType,
      description: `${metrics.config.maxMemoryMb}MB RAM, ${metrics.config.cpuQuotaPercent}% CPU per VM`,
    },
    {
      title: "Uptime",
      value: formatUptime(metrics.uptime),
      description: "Server running time",
    },
    {
      title: "Timeout / TTL",
      value: `${metrics.config.defaultTimeoutMs / 1000}s / ${metrics.config.sandboxTtlMs / 60000}m`,
      description: "Execution timeout / idle TTL",
    },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.title}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{card.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{card.value}</div>
            <p className="text-xs text-muted-foreground">{card.description}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
