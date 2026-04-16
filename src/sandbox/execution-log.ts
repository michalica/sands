import { v4 as uuidv4 } from "uuid";
import type { ExecutionResult } from "./types.js";

export interface LogEntry {
  executionId: string;
  timestamp: number;
  code: string;
  result: ExecutionResult;
}

export class ExecutionLog {
  private logs = new Map<string, LogEntry[]>();

  append(sandboxId: string, input: { code: string; result: ExecutionResult }): void {
    const entries = this.logs.get(sandboxId) ?? [];
    entries.push({
      executionId: uuidv4(),
      timestamp: Date.now(),
      code: input.code,
      result: input.result,
    });
    this.logs.set(sandboxId, entries);
  }

  get(sandboxId: string): LogEntry[] {
    return this.logs.get(sandboxId) ?? [];
  }

  clear(sandboxId: string): void {
    this.logs.delete(sandboxId);
  }
}
