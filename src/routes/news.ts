import { Hono } from "hono";
import type { AppEnv } from "../lib/env";
import { findRoomId } from "../lib/rooms";
import { admin } from "../middleware/admin";

const MAX_NEWS_TITLE = 200;
const MAX_NEWS_BODY = 5000;

// News (D1), written by admin
export const newsRoutes = new Hono<AppEnv>();

newsRoutes.get("/cities/:city/rooms/:slug/news", async (c) => {
  const id = await findRoomId(c.env.HERDS_DB, c.req.param("city"), c.req.param("slug"));
  if (id === null) return c.json({ error: "room not found" }, 404);

  const { results } = await c.env.HERDS_DB
    .prepare(
      `SELECT id, title, body, created_at FROM news
       WHERE room_id = ? ORDER BY created_at DESC, id DESC LIMIT 50`,
    )
    .bind(id)
    .all();

  return c.json(results);
});

newsRoutes.post("/cities/:city/rooms/:slug/news", admin, async (c) => {
  const data = await c.req.json<{ title?: string; body?: string }>().catch(() => null);
  const title = data?.title?.trim();
  const body = data?.body?.trim();

  if (!title || title.length > MAX_NEWS_TITLE) return c.json({ error: "invalid title" }, 400);
  if (!body || body.length > MAX_NEWS_BODY) return c.json({ error: "invalid body" }, 400);

  const id = await findRoomId(c.env.HERDS_DB, c.req.param("city"), c.req.param("slug"));
  if (id === null) return c.json({ error: "room not found" }, 404);

  const item = await c.env.HERDS_DB
    .prepare(
      "INSERT INTO news (room_id, title, body) VALUES (?, ?, ?) RETURNING id, title, body, created_at",
    )
    .bind(id, title, body)
    .first();

  return c.json(item, 201);
});

newsRoutes.delete("/cities/:city/rooms/:slug/news/:id", admin, async (c) => {
  const newsId = Number(c.req.param("id"));
  if (!Number.isInteger(newsId)) return c.json({ error: "invalid id" }, 400);

  const roomId = await findRoomId(c.env.HERDS_DB, c.req.param("city"), c.req.param("slug"));
  if (roomId === null) return c.json({ error: "room not found" }, 404);

  // scoped to the room, so an id from another room can't be deleted through this URL
  const result = await c.env.HERDS_DB
    .prepare("DELETE FROM news WHERE id = ? AND room_id = ?")
    .bind(newsId, roomId)
    .run();

  if (result.meta.changes === 0) return c.json({ error: "news not found" }, 404);
  return c.body(null, 204);
});