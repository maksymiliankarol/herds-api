import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { clientKey } from "../lib/client";
import type { AppEnv } from "../lib/env";

// Returns a 429 response when the caller is over the limit, otherwise null
export async function limitedResponse(c: Context<AppEnv>, limiter: RateLimit) {
  const { success } = await limiter.limit({ key: clientKey(c.req.raw) });
  if (success) return null;
  return c.json({ error: "too many requests" }, 429, { "Retry-After": "60" });
}

type LimiterName = "READ_LIMITER" | "MESSAGES_LIMITER";

// Per-IP limiter for a route or a group of routes; the limits live in wrangler.jsonc
export const rateLimit = (name: LimiterName) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const limited = await limitedResponse(c, c.env[name]);
    if (limited) return limited;
    await next();
  });