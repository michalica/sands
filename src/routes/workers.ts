import type { FastifyInstance } from "fastify";
import type { WorkerCluster } from "../control-plane/worker-cluster.js";

interface RegisterBody {
  workerId: string;
  url: string;
  activeSandboxes: number;
  maxSandboxes: number;
}

interface HeartbeatBody {
  activeSandboxes: number;
  maxSandboxes: number;
}

export function registerWorkerAuth(app: FastifyInstance, token: string, prefixes: string[]): void {
  app.addHook("preHandler", async (req, reply) => {
    const url = req.url.split("?")[0];
    const matched = prefixes.some((p) => url === p || url.startsWith(p + "/"));
    if (!matched) return;
    if (req.headers.authorization !== `Bearer ${token}`) {
      reply.code(401);
      return reply.send({ error: "unauthorized" });
    }
  });
}

export async function workerRoutes(app: FastifyInstance, cluster: WorkerCluster): Promise<void> {
  app.post<{ Body: RegisterBody }>("/workers/register", async (request) => {
    const body = request.body;
    cluster.registerWorker({
      workerId: body.workerId,
      url: body.url,
      active: body.activeSandboxes,
      max: body.maxSandboxes,
    });
    return { ok: true };
  });

  app.post<{ Params: { id: string }; Body: HeartbeatBody }>(
    "/workers/:id/heartbeat",
    async (request, reply) => {
      const ok = cluster.updateHeartbeat(request.params.id, {
        active: request.body.activeSandboxes,
        max: request.body.maxSandboxes,
      });
      if (!ok) {
        reply.code(410);
        return { error: "unknown worker — please re-register" };
      }
      return { ok: true };
    },
  );

  app.get("/workers", async () => ({ workers: cluster.listWorkers() }));
}
