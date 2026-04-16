import type { FastifyInstance } from "fastify";
import { SandboxManager, SandboxNotFoundError } from "../sandbox/manager.js";

interface ExecuteBody {
  code: string;
  timeoutMs?: number;
}

interface SandboxParams {
  id: string;
}

export async function sandboxRoutes(app: FastifyInstance, manager: SandboxManager) {
  // Create sandbox
  app.post("/sandboxes", async (_request, reply) => {
    const info = await manager.create();
    reply.code(201);
    return { sandboxId: info.sandboxId };
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
