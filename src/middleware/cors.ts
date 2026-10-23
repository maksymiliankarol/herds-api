import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../lib/env";

// The allowed origin comes from env, so the cors() options are built per request
export const corsFromEnv = createMiddleware<AppEnv>((c, next) =>
  cors({ origin: new URL(c.env.WEB_URL).origin, allowMethods: ["GET", "POST", "DELETE"] })(c, next)
);