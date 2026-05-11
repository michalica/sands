import type { FastifyInstance } from "fastify";
import { SandboxManager, SandboxNotFoundError, SandboxLimitError, UnknownTemplateError } from "../sandbox/manager.js";

interface ExecuteBody {
  code: string;
  timeoutMs?: number;
}

interface CreateSandboxBody {
  template?: string;
}

interface SandboxParams {
  id: string;
}

function logContext(request: { id: string; userId?: string }, extra?: Record<string, unknown>) {
  return {
    request_id: request.id,
    user_id: request.userId ?? null,
    ...extra,
  };
}

export async function sandboxRoutes(app: FastifyInstance, manager: SandboxManager) {
  // List all sandboxes
  app.get<{ Querystring: { status?: string } }>("/sandboxes", async (request) => {
    const status = request.query.status as "running" | "destroyed" | "all" | undefined;
    const userId = request.userId ?? null;
    return {
      sandboxes: manager.listSandboxes(status, userId),
      count: manager.activeSandboxCount,
      maxCount: manager.maxSandboxCount,
    };
  });

  // Get sandbox detail
  app.get<{ Params: SandboxParams }>("/sandboxes/:id", async (request, reply) => {
    const { id } = request.params;
    try {
      return manager.getSandbox(id, request.userId ?? null);
    } catch (err) {
      if (err instanceof SandboxNotFoundError) {
        reply.code(404);
        return { error: "Sandbox not found" };
      }
      throw err;
    }
  });

  // Create sandbox
  app.post("/sandboxes", async (request, reply) => {
    try {
      const body = (request.body as CreateSandboxBody | undefined) ?? {};
      const info = await manager.create(request.userId ?? null, body.template ?? "node-22");
      request.log.info(
        logContext(request, {
          sandbox_id: info.sandboxId,
          template: info.templateId,
        }),
        "sandbox created",
      );
      reply.code(201);
      return { sandboxId: info.sandboxId };
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
        const sandbox = manager.getSandbox(id, request.userId ?? null);
        const result = await manager.execute(id, code, timeoutMs, request.userId ?? null);
        request.log.info(
          logContext(request, {
            sandbox_id: id,
            template: sandbox.templateId,
            outcome: result.timedOut ? "timeout" : result.exitCode === 0 ? "success" : "error",
          }),
          "sandbox executed",
        );
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
      const sandbox = manager.getSandbox(id, request.userId ?? null);
      const logs = manager.getLogs(id, request.userId ?? null);
      request.log.info(
        logContext(request, {
          sandbox_id: id,
          template: sandbox.templateId,
        }),
        "sandbox logs requested",
      );
      return logs;
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
      const sandbox = manager.getSandbox(id, request.userId ?? null);
      await manager.destroy(id, request.userId ?? null);
      request.log.info(
        logContext(request, {
          sandbox_id: id,
          template: sandbox.templateId,
        }),
        "sandbox destroyed",
      );
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

  app.get("/templates", async () => {
    const templates = manager.listTemplates();
    return { templates };
  });
}
