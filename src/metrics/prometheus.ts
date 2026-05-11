import type { ExecutionResult } from "../sandbox/types.js";

type ExecutionOutcome = "success" | "error" | "timeout";

class Histogram {
  private counts: number[];
  private sum = 0;
  private count = 0;

  constructor(private buckets: number[]) {
    this.counts = buckets.map(() => 0);
  }

  observe(value: number): void {
    this.sum += value;
    this.count += 1;
    for (let i = 0; i < this.buckets.length; i += 1) {
      if (value <= this.buckets[i]) {
        this.counts[i] += 1;
      }
    }
  }

  render(name: string, help: string): string[] {
    const lines = [`# HELP ${name} ${help}`, `# TYPE ${name} histogram`];
    for (let i = 0; i < this.buckets.length; i += 1) {
      lines.push(`${name}_bucket{le="${this.buckets[i]}"} ${this.counts[i]}`);
    }
    lines.push(`${name}_bucket{le="+Inf"} ${this.count}`);
    lines.push(`${name}_sum ${this.sum}`);
    lines.push(`${name}_count ${this.count}`);
    return lines;
  }
}

export class SandboxMetrics {
  private sandboxesCreatedTotal = 0;
  private sandboxesDestroyedTotal = 0;
  private executionsTotal: Record<ExecutionOutcome, number> = {
    success: 0,
    error: 0,
    timeout: 0,
  };
  private coldStartMs = new Histogram([10, 25, 50, 100, 250, 500, 1000, 5000]);
  private executionMs = new Histogram([1, 5, 10, 25, 50, 100, 250, 500, 1000, 5000, 30000]);
  private templateLoadMs = new Histogram([0, 1, 5, 10, 25, 50, 100, 250, 500, 1000]);

  recordSandboxCreated(coldStartMs: number, templateLoadMs: number): void {
    this.sandboxesCreatedTotal += 1;
    this.coldStartMs.observe(coldStartMs);
    this.templateLoadMs.observe(templateLoadMs);
  }

  recordSandboxDestroyed(): void {
    this.sandboxesDestroyedTotal += 1;
  }

  recordExecution(result: ExecutionResult): void {
    this.executionsTotal[this.executionOutcome(result)] += 1;
    this.executionMs.observe(result.durationMs);
  }

  toJSON(activeSandboxes: number, maxSandboxes: number, backendType: string, uptimeSeconds: number, maxMemoryMb: number) {
    return {
      activeSandboxes,
      maxSandboxes,
      backendType,
      uptime: uptimeSeconds,
      config: {
        maxMemoryMb,
      },
      counters: {
        sandboxesCreatedTotal: this.sandboxesCreatedTotal,
        sandboxesDestroyedTotal: this.sandboxesDestroyedTotal,
        executionsTotal: { ...this.executionsTotal },
      },
      gauges: {
        microvmMemoryUsedBytes: this.memoryUsedBytes(activeSandboxes, maxMemoryMb),
      },
    };
  }

  renderPrometheus(activeSandboxes: number, maxSandboxes: number, maxMemoryMb: number): string {
    const lines = [
      "# HELP sandboxes_created_total Total number of sandboxes created",
      "# TYPE sandboxes_created_total counter",
      `sandboxes_created_total ${this.sandboxesCreatedTotal}`,
      "# HELP sandboxes_destroyed_total Total number of sandboxes destroyed",
      "# TYPE sandboxes_destroyed_total counter",
      `sandboxes_destroyed_total ${this.sandboxesDestroyedTotal}`,
      "# HELP executions_total Total number of sandbox executions by outcome",
      "# TYPE executions_total counter",
      `executions_total{outcome="success"} ${this.executionsTotal.success}`,
      `executions_total{outcome="error"} ${this.executionsTotal.error}`,
      `executions_total{outcome="timeout"} ${this.executionsTotal.timeout}`,
      "# HELP active_sandboxes Current number of active sandboxes",
      "# TYPE active_sandboxes gauge",
      `active_sandboxes ${activeSandboxes}`,
      "# HELP max_sandboxes Configured maximum number of sandboxes",
      "# TYPE max_sandboxes gauge",
      `max_sandboxes ${maxSandboxes}`,
      "# HELP microvm_memory_used_bytes Estimated memory reserved by active sandboxes",
      "# TYPE microvm_memory_used_bytes gauge",
      `microvm_memory_used_bytes ${this.memoryUsedBytes(activeSandboxes, maxMemoryMb)}`,
      ...this.coldStartMs.render("cold_start_ms", "Sandbox cold start duration in milliseconds"),
      ...this.executionMs.render("execution_ms", "Sandbox execution duration in milliseconds"),
      ...this.templateLoadMs.render("template_load_ms", "Template load duration in milliseconds"),
    ];

    return `${lines.join("\n")}\n`;
  }

  private executionOutcome(result: ExecutionResult): ExecutionOutcome {
    if (result.timedOut) return "timeout";
    if (result.exitCode === 0) return "success";
    return "error";
  }

  private memoryUsedBytes(activeSandboxes: number, maxMemoryMb: number): number {
    return activeSandboxes * maxMemoryMb * 1024 * 1024;
  }
}
