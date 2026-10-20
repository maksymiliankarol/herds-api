import { Hono } from "hono";
import type { AppEnv } from "../lib/env";
import { findRoomId, roomStub } from "../lib/rooms";
import { rateLimit } from "../middleware/rate-limit";

// Messages live in the Durable Object and can only be posted through the WebSocket.
export const messagesRoutes = new Hono<AppEnv>();

// Tighter limit than other reads: this route wakes the Durable Object
messagesRoutes.get("/cities/:city/rooms/:slug/messages", rateLimit("MESSAGES_LIMITER"), async (c) => {
  const id = await findRoomId(c.env.herds_db, c.req.param("city"), c.req.param("slug"));
  if (id === null) return c.json({ error: "room not found" }, 404);
  return c.json(await roomStub(c.env, id).listMessages());
});