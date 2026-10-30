import { createMiddleware } from "hono/factory";
import { safeEqual } from "../lib/crypto";
import { errorBody } from "../lib/error-codes";
import type { AppEnv } from "../lib/env";
import { limitedResponse } from "./rate-limit";

// Bearer-token guard for admin routes
export const admin = createMiddleware<AppEnv>(async (c, next) => {
  // rate limit first, so token guessing is throttled too
  const limited = await limitedResponse(c, c.env.ADMIN_LIMITER);
  if (limited) return limited;

  const expected = c.env.ADMIN_TOKEN;
  if (!expected) return c.json(errorBody("admin_not_configured"), 500); // fail closed

  const match = c.req.header("Authorization")?.match(/^Bearer (.+)$/);
  if (!match || !(await safeEqual(match[1], expected))) {
    return c.json(errorBody("unauthorized"), 401, {
      "WWW-Authenticate": 'Bearer realm="admin"',
    });
  }

  await next();
});