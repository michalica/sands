import type { FastifyInstance } from "fastify";

/**
 * Worker daemon auth: a single shared bearer token between the control plane
 * and every worker. All routes except `/health` require it.
 *
 * This is internal-VPC traffic; we don't need mTLS at v1.
 */
export function registerControlPlaneAuth(app: FastifyInstance, token: string): void {
  app.addHook("preHandler", async (req, reply) => {
    const url = req.url.split("?")[0];
    if (url === "/health") return;
    const header = req.headers.authorization;
    if (header !== `Bearer ${token}`) {
      reply.code(401);
      return reply.send({ error: "unauthorized" });
    }
  });
}
