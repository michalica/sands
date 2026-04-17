import type { FastifyInstance } from "fastify";
import type { WebSocket } from "@fastify/websocket";

export type SandboxEvent =
  | { type: "sandbox:created"; sandboxId: string; createdAt: number }
  | { type: "sandbox:destroyed"; sandboxId: string }
  | { type: "execution:completed"; sandboxId: string; executionId: string; code: string; result: { stdout: string; stderr: string; exitCode: number; durationMs: number; timedOut: boolean } }
  | { type: "metrics"; activeSandboxes: number; maxSandboxes: number };

const clients = new Set<WebSocket>();

export function broadcastEvent(event: SandboxEvent) {
  const data = JSON.stringify(event);
  for (const client of clients) {
    if (client.readyState === 1) { // OPEN
      client.send(data);
    } else {
      clients.delete(client);
    }
  }
}

export async function eventsRoutes(app: FastifyInstance) {
  app.get("/events", { websocket: true }, (socket) => {
    clients.add(socket);
    socket.on("close", () => {
      clients.delete(socket);
    });
  });
}
