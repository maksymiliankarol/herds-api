import { Hono } from "hono";
import { vValidator } from "@hono/valibot-validator";
import { IdParamSchema, UsernameSchema } from "../schema";
import { ALLOWED_ORIGINS } from "../config";

const chat = new Hono<{ Bindings: CloudflareBindings }>();

chat.get(
  "/:id",
  vValidator("param", IdParamSchema),
  vValidator("query", UsernameSchema),
  async (c) => {
    const origin = c.req.header("origin");
    if (!origin || !ALLOWED_ORIGINS.includes(origin)) {
      return c.json({ error: "Forbidden" }, 403);
    }

    if (c.req.header("upgrade") !== "websocket") {
      return c.json({ error: "Expected WebSocket" }, 426);
    }

    const { id } = c.req.valid("param");
    const ip = c.req.header("cf-connecting-ip") ?? "unknown";

    const banned = await c.env.DB
      .prepare("SELECT 1 FROM bans WHERE ip = ? AND expires_at > datetime('now')")
      .bind(ip)
      .first();
    if (banned) return c.json({ error: "Banned" }, 403);

    // Only rooms that exist in D1 get a Durable Object
    const room = await c.env.DB.prepare("SELECT id FROM rooms WHERE id = ?").bind(id).first();
    if (!room) return c.json({ error: "Room not found" }, 404);

    const stub = c.env.CHAT_ROOM.get(c.env.CHAT_ROOM.idFromName(String(id)));
    return stub.fetch(c.req.raw);
  },
);

export default chat;