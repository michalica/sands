import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { auth } from "./auth.js";

declare module "fastify" {
  interface FastifyRequest {
    userId?: string;
  }
}

interface CacheEntry {
  userId: string;
  expiresAt: number;
}

const CACHE_TTL_MS = 5_000;
const cache = new Map<string, CacheEntry>();

function lookupCached(key: string): string | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.userId;
}

function rememberKey(key: string, userId: string): void {
  cache.set(key, { userId, expiresAt: Date.now() + CACHE_TTL_MS });
  if (cache.size > 1024) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
}

function toFetchHeaders(req: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) headers.append(name, v);
    } else {
      headers.set(name, String(value));
    }
  }
  return headers;
}

async function verifyKey(key: string): Promise<string | null> {
  const cached = lookupCached(key);
  if (cached) return cached;
  const result = await auth.api.verifyApiKey({ body: { key } });
  if (!result.valid || !result.key) return null;
  rememberKey(key, result.key.referenceId);
  return result.key.referenceId;
}

/**
 * Resolves the caller's userId from any supported credential:
 *   - `Authorization: Bearer <api-key>` header
 *   - `?token=<api-key>` query param (used by WebSocket clients that can't set headers)
 *   - Better Auth session cookie (the dashboard itself)
 *
 * Returns the userId, or null if no valid credential is present.
 */
export async function resolveUserId(req: FastifyRequest): Promise<string | null> {
  const header = req.headers.authorization;
  const bearer = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
  if (bearer) {
    const userId = await verifyKey(bearer);
    if (userId) return userId;
  }

  const queryToken = (req.query as Record<string, unknown> | undefined)?.token;
  if (typeof queryToken === "string" && queryToken.length > 0) {
    const userId = await verifyKey(queryToken);
    if (userId) return userId;
  }

  const session = await auth.api.getSession({ headers: toFetchHeaders(req) });
  if (session?.user) return session.user.id;

  return null;
}

export async function requireApiKey(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const userId = await resolveUserId(req);
  if (!userId) {
    reply.code(401).send({ error: "Authentication required" });
    return;
  }
  req.userId = userId;
}

export function registerApiKeyAuth(app: FastifyInstance, prefixes: string[]): void {
  app.addHook("preHandler", async (req, reply) => {
    const url = req.url.split("?")[0];
    const matched = prefixes.some((p) => url === p || url.startsWith(p + "/"));
    if (!matched) return;
    await requireApiKey(req, reply);
  });
}
