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

export interface SandboxNetworkPolicy {
  enabled: boolean;
  allowed: string[];
  disallowed: string[];
}

export interface SandboxTemplate {
  id: string;
  name: string;
  version: string;
  rootfsPath: string;
  kernelPath: string;
  defaultPackages: string[];
  buildMeta: Record<string, unknown>;
}

export interface SandboxBackend {
  create(sandboxId: string, template?: SandboxTemplate, networkPolicy?: SandboxNetworkPolicy): Promise<void>;
  execute(sandboxId: string, code: string, timeoutMs: number): Promise<ExecutionResult>;
  destroy(sandboxId: string): Promise<void>;
  exists(sandboxId: string): boolean;
}
