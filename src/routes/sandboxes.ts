import type { FastifyInstance } from "fastify";
import { SandboxManager, SandboxNotFoundError, SandboxLimitError } from "../sandbox/manager.js";

interface ExecuteBody {
  code: string;
  timeoutMs?: number;
}

interface SandboxParams {
  id: string;
}

export async function sandboxRoutes(app: FastifyInstance, manager: SandboxManager) {
  // List all sandboxes
  app.get("/sandboxes", async () => {
    return {
      sandboxes: manager.listSandboxes(),
      count: manager.activeSandboxCount,
      maxCount: manager.maxSandboxCount,
    };
  });

  // Get sandbox detail
  app.get<{ Params: SandboxParams }>("/sandboxes/:id", async (request, reply) => {
    const { id } = request.params;
    try {
      return manager.getSandbox(id);
    } catch (err) {
      if (err instanceof SandboxNotFoundError) {
        reply.code(404);
        return { error: "Sandbox not found" };
      }
      throw err;
    }
  });

  // Create sandbox
  app.post("/sandboxes", async (_request, reply) => {
    try {
      const info = await manager.create();
      reply.code(201);
      return { sandboxId: info.sandboxId };
    } catch (err) {
      if (err instanceof SandboxLimitError) {
        reply.code(429);
        return { error: err.message };
      }
      throw err;
    }
  });

  // Execute code
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

  // Get execution logs
  app.get<{ Params: SandboxParams }>("/sandboxes/:id/logs", async (request, reply) => {
    const { id } = request.params;

    try {
      return manager.getLogs(id);
    } catch (err) {
      if (err instanceof SandboxNotFoundError) {
        reply.code(404);
        return { error: "Sandbox not found" };
      }
      throw err;
    }
  });

  // Destroy sandbox
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
