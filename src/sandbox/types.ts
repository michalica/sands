export interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
}

export interface SandboxInfo {
  sandboxId: string;
  createdAt: number;
  lastUsedAt: number;
}

export interface SandboxBackend {
  create(sandboxId: string): Promise<void>;
  execute(sandboxId: string, code: string, timeoutMs: number): Promise<ExecutionResult>;
  destroy(sandboxId: string): Promise<void>;
  exists(sandboxId: string): boolean;
}
