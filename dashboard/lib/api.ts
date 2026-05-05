const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

const fetchOpts: RequestInit = { credentials: "include" };

async function jsonOrNull<T>(res: Response): Promise<T | null> {
  if (!res.ok) return null;
  return res.json() as Promise<T>;
}

export interface SandboxInfo {
  sandboxId: string;
  createdAt: number;
  lastUsedAt: number;
  executionCount: number;
}

export interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
}

export interface LogEntry {
  executionId: string;
  timestamp: number;
  code: string;
  result: ExecutionResult;
}

export interface Metrics {
  activeSandboxes: number;
  maxSandboxes: number;
  backendType: string;
  uptime: number;
  config: {
    defaultTimeoutMs: number;
    maxMemoryMb: number;
    sandboxTtlMs: number;
    cpuQuotaPercent: number;
  };
}

export interface SandboxEvent {
  type: "sandbox:created" | "sandbox:destroyed" | "execution:completed" | "metrics";
  sandboxId?: string;
  [key: string]: unknown;
}

export async function fetchMetrics(): Promise<Metrics | null> {
  const res = await fetch(`${API_URL}/metrics`, fetchOpts);
  return jsonOrNull<Metrics>(res);
}

export async function fetchSandboxes(): Promise<{ sandboxes: SandboxInfo[]; count: number; maxCount: number }> {
  const res = await fetch(`${API_URL}/sandboxes`, fetchOpts);
  const data = await jsonOrNull<{ sandboxes: SandboxInfo[]; count: number; maxCount: number }>(res);
  return data ?? { sandboxes: [], count: 0, maxCount: 0 };
}

export async function fetchSandbox(id: string): Promise<SandboxInfo & { lastExecution: LogEntry | null }> {
  const res = await fetch(`${API_URL}/sandboxes/${id}`, fetchOpts);
  if (!res.ok) throw new Error("Sandbox not found");
  return res.json();
}

export async function fetchLogs(id: string): Promise<LogEntry[]> {
  const res = await fetch(`${API_URL}/sandboxes/${id}/logs`, fetchOpts);
  if (!res.ok) throw new Error("Sandbox not found");
  return res.json();
}

export async function destroySandbox(id: string): Promise<void> {
  await fetch(`${API_URL}/sandboxes/${id}`, { ...fetchOpts, method: "DELETE" });
}

export function createEventsSocket(onEvent: (event: SandboxEvent) => void): WebSocket {
  const wsUrl = API_URL.replace(/^http/, "ws");
  const ws = new WebSocket(`${wsUrl}/events`);
  ws.onmessage = (e) => {
    try {
      onEvent(JSON.parse(e.data));
    } catch {}
  };
  return ws;
}
