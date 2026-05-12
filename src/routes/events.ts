import type { FastifyInstance } from "fastify";
import type { WebSocket } from "@fastify/websocket";

// resolveUserId pulls in auth.ts, which eagerly opens SQLite. The worker
// imports this file via SandboxManager (for broadcastEvent) but doesn't
// run eventsRoutes — so we keep the import lazy to avoid that side-effect.

export type SandboxEvent =
  | { type: "sandbox:created"; sandboxId: string; createdAt: number }
  | { type: "sandbox:destroyed"; sandboxId: string }
  | { type: "execution:completed"; sandboxId: string; executionId: string; code: string; result: { stdout: string; stderr: string; exitCode: number; durationMs: number; timedOut: boolean } }
  | { type: "metrics"; activeSandboxes: number; maxSandboxes: number };

interface Subscriber {
  socket: WebSocket;
  userId: string;
}

const subscribers = new Set<Subscriber>();

/**
 * Broadcast an event to subscribers belonging to `userId`. Pass null only for
 * truly global events (e.g. operator-level metrics) — sandbox events should
 * always carry the owning user.
 */
export function broadcastEvent(userId: string | null, event: SandboxEvent) {
  const data = JSON.stringify(event);
  for (const sub of subscribers) {
    if (sub.socket.readyState !== 1) {
      subscribers.delete(sub);
      continue;
    }
    if (userId !== null && sub.userId !== userId) continue;
    sub.socket.send(data);
  }
}

export async function eventsRoutes(app: FastifyInstance) {
  app.get(
    "/events",
    {
      websocket: true,
      preHandler: async (req, reply) => {
        const { resolveUserId } = await import("../auth-hook.js");
        const userId = await resolveUserId(req);
        if (!userId) {
          reply.code(401).send({ error: "Authentication required" });
          return;
        }
        req.userId = userId;
      },
    },
    (socket, req) => {
      const userId = req.userId;
      if (!userId) {
        socket.close(1008, "unauthenticated");
        return;
      }
      const sub: Subscriber = { socket, userId };
      subscribers.add(sub);
      socket.on("close", () => {
        subscribers.delete(sub);
      });
    },
  );
}
