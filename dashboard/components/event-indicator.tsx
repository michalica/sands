"use client";

import { useEffect, useState } from "react";
import { ActivityIcon } from "lucide-react";
import type { SandboxEvent } from "@/lib/api";

export function EventIndicator({ lastEvent }: { lastEvent: SandboxEvent | null }) {
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    if (!lastEvent) return;
    setPulse(true);
    const t = setTimeout(() => setPulse(false), 1000);
    return () => clearTimeout(t);
  }, [lastEvent]);

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <ActivityIcon className={`size-3 ${pulse ? "text-emerald-500" : ""}`} />
      <span>{lastEvent ? lastEvent.type : "Live"}</span>
    </div>
  );
}
