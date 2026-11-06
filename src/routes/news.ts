import { Hono } from "hono";
import { vValidator } from "@hono/valibot-validator";
import { NewsSchema, NewsQuerySchema, IdParamSchema } from "../schema";
import { admin } from "../middleware/admin";

const news = new Hono<{ Bindings: CloudflareBindings }>();

news.get("/", vValidator("query", NewsQuerySchema), async (c) => {
  const { room_id } = c.req.valid("query");

  const { results } = await c.env.DB
    .prepare("SELECT id, title, content, created_at FROM news WHERE room_id = ? ORDER BY created_at DESC, id DESC LIMIT 10")
    .bind(room_id)
    .all();

  return c.json(results);
});

news.post("/", admin, vValidator("json", NewsSchema), async (c) => {
  const { title, content, room_id } = c.req.valid("json");

  try {
    const row = await c.env.DB
      .prepare("INSERT INTO news (title, content, room_id) VALUES (?, ?, ?) RETURNING *")
      .bind(title, content, room_id)
      .first();
    return c.json(row, 201);
  } catch (e) {
    if (String(e).includes("FOREIGN KEY")) {
      return c.json({ error: "Room not found" }, 404);
    }
    throw e;
  }
});

news.delete("/:id", admin, vValidator("param", IdParamSchema), async (c) => {
  const { id } = c.req.valid("param");

  const { meta } = await c.env.DB
    .prepare("DELETE FROM news WHERE id = ?")
    .bind(id)
    .run();
  if (meta.changes === 0) return c.json({ error: "Not found" }, 404);

  return c.body(null, 204);
});

export default news;