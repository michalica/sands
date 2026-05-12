import type { FastifyInstance } from "fastify";
import {
  SandboxManager,
  SandboxNotFoundError,
  SandboxLimitError,
  UnknownTemplateError,
} from "../sandbox/manager.js";

interface CreateBody {
  /** Optional override for the sandbox id. Control plane provides this so it
   *  can record the mapping before the worker boots the VM. */
  sandboxId?: string;
  templateId?: string;
}

interface ExecuteBody {
  code: string;
  timeoutMs?: number;
}

interface SandboxParams {
  id: string;
}

export async function workerRoutes(app: FastifyInstance, manager: SandboxManager) {
  // GET /capacity — used by control plane scheduler + heartbeat self-check.
  app.get("/capacity", async () => ({
    activeSandboxes: manager.activeSandboxCount,
    maxSandboxes: manager.maxSandboxCount,
    available: Math.max(0, manager.maxSandboxCount - manager.activeSandboxCount),
  }));

  // GET /sandboxes — list locally active sandboxes (reconciliation only).
  app.get("/sandboxes", async () => ({
    sandboxes: manager.listSandboxes("running"),
    count: manager.activeSandboxCount,
    maxCount: manager.maxSandboxCount,
  }));

  // POST /sandboxes — create a sandbox on this worker.
  app.post<{ Body: CreateBody }>("/sandboxes", async (request, reply) => {
    try {
      const body = (request.body ?? {}) as CreateBody;
      // Worker owns no userId. Control plane records the user ↔ sandbox
      // mapping in its own DB; the worker just runs the VM.
      const info = await manager.create(null, body.templateId ?? "node-22");
      reply.code(201);
      return { sandboxId: info.sandboxId, templateId: info.templateId };
    } catch (err) {
      if (err instanceof SandboxLimitError) {
        reply.code(429);
        return { error: err.message };
      }
      if (err instanceof UnknownTemplateError) {
        reply.code(400);
        return { error: err.message };
      }
      throw err;
    }
  });

  // POST /sandboxes/:id/execute — run code in the sandbox.
  app.post<{ Params: SandboxParams; Body: ExecuteBody }>(
    "/sandboxes/:id/execute",
    {
      schema: {
        body: {
          type: "object",
          required: ["code"],
          properties: {
            code: { type: "string" },
            timeoutMs: { type: "number", minimum: 100, maximum: 30000 },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const { code, timeoutMs } = request.body;
      try {
        const result = await manager.execute(id, code, timeoutMs);
        return result;
      } catch (err) {
        if (err instanceof SandboxNotFoundError) {
          reply.code(404);
          return { error: "Sandbox not found" };
        }
        throw err;
      }
    },
  );

  // DELETE /sandboxes/:id — destroy the sandbox.
  app.delete<{ Params: SandboxParams }>("/sandboxes/:id", async (request, reply) => {
    const { id } = request.params;
    try {
      await manager.destroy(id);
      reply.code(204);
      return;
    } catch (err) {
      if (err instanceof SandboxNotFoundError) {
        reply.code(404);
        return { error: "Sandbox not found" };
      }
      throw err;
    }
  });
}
