import { Hono } from "hono";
import { clientKey } from "../lib/client";
import { errorBody } from "../lib/error-codes";
import type { AppEnv } from "../lib/env";
import { findRoomId, roomStub } from "../lib/rooms";
import { rejectUpgrade } from "../lib/ws";
import { verifyTurnstile } from "../lib/turnstile";

const CLOSE_VERIFICATION_FAILED = 4403;

export const wsRoutes = new Hono<AppEnv>();

wsRoutes.get("/cities/:city/rooms/:slug/ws", async (c) => {
  if (c.req.header("Upgrade") !== "websocket") {
    return c.json(errorBody("upgrade_required"), 426);
  }

  const { success } = await c.env.WS_LIMITER.limit({ key: clientKey(c.req.raw) });
  if (!success) return c.json(errorBody("rate_limited"), 429, { "Retry-After": "60" });

  // CORS doesn't protect WebSockets, so check the Origin yourself
  const origin = c.req.header("Origin");
  if (origin && origin !== new URL(c.env.WEB_URL).origin) {
    return c.json(errorBody("forbidden_origin"), 403);
  }

  // a Turnstile token is single-use, so every connect needs a fresh one
  if (!c.env.TURNSTILE_SECRET) {
    console.error("TURNSTILE_SECRET is not set"); // fail closed
    return c.json(errorBody("internal"), 500);
  }
  const token = c.req.query("token") ?? "";
  const human = await verifyTurnstile(token, c.env.TURNSTILE_SECRET, c.req.header("CF-Connecting-IP"));
  if (!human) return rejectUpgrade(CLOSE_VERIFICATION_FAILED);

  const id = await findRoomId(c.env.HERDS_DB, c.req.param("city"), c.req.param("slug"));
  if (id === null) return c.json(errorBody("room_not_found"), 404);

  // the Room doesn't need the token: strip it before forwarding
  const url = new URL(c.req.url);
  url.searchParams.delete("token");
  return roomStub(c.env, id).fetch(new Request(url, c.req.raw));
});