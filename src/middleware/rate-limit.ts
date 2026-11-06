import { createMiddleware } from "hono/factory";

export const rateLimit = createMiddleware<{ Bindings: CloudflareBindings }>(
  async (c, next) => {
    const ip = c.req.header("cf-connecting-ip") ?? "unknown";
    const { success } = await c.env.RATE_LIMITER.limit({ key: ip });

    if (!success) {
      return c.json({ error: "Too many requests" }, 429);
    }

    await next();
  },
);