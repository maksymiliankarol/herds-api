import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { bearerAuth } from "hono/bearer-auth";

export const admin = createMiddleware<{ Bindings: CloudflareBindings }>(
  (c, next) => bearerAuth({ token: c.env.ADMIN_KEY })(c as unknown as Context, next),
);