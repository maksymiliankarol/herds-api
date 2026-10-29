import { Hono } from "hono";

import { SOURCES } from "../news/sources";
import { writeDraft } from "../news/draft";
import { findRoomId } from "../../src/lib/rooms";
import { AppEnv } from "../../src/lib/env";
import { admin } from "../../src/middleware/admin";

const MAX_NEWS_TITLE = 200;
const MAX_NEWS_BODY = 5000;

// AI-written news drafts: nothing is public until an admin publishes one.
export const newsDraftsRoutes = new Hono<AppEnv>();

// Generate a draft: { "room": "krakow/education" }
newsDraftsRoutes.post("/admin/news-drafts", admin, async (c) => {
  const data = await c.req.json<{ room?: string }>().catch(() => null);
  const room = data?.room ?? "";
  const urls = SOURCES[room];
  if (!urls) return c.json({ error: "no sources for this room", known: Object.keys(SOURCES) }, 404);

  const [city, slug] = room.split("/");
  const roomId = await findRoomId(c.env.HERDS_DB, city, slug);
  if (roomId === null) return c.json({ error: "room not found" }, 404);

  const draft = await writeDraft(c.env, urls);
  if (!draft) return c.json({ message: "nothing worth posting" });

  const row = await c.env.HERDS_DB
    .prepare(
      `INSERT INTO news_drafts (room_id, title, body, sources) VALUES (?, ?, ?, ?)
       RETURNING id, title, body, sources, created_at`,
    )
    .bind(roomId, draft.title, draft.body, JSON.stringify(draft.sources))
    .first<{ sources: string }>();

  return c.json({ ...row, room, sources: draft.sources }, 201);
});

// List pending drafts
newsDraftsRoutes.get("/admin/news-drafts", admin, async (c) => {
  const { results } = await c.env.HERDS_DB
    .prepare(
      `SELECT d.id, cities.slug AS city, rooms.slug AS room, d.title, d.body, d.sources, d.created_at
       FROM news_drafts d
       JOIN rooms ON rooms.id = d.room_id
       JOIN cities ON cities.id = rooms.city_id
       ORDER BY d.created_at DESC`,
    )
    .all<{ sources: string }>();

  return c.json(results.map((r) => ({ ...r, sources: JSON.parse(r.sources) as string[] })));
});

// Publish a draft. Optional { title, body } replace the generated text (your edits).
newsDraftsRoutes.post("/admin/news-drafts/:id/publish", admin, async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid id" }, 400);

  const draft = await c.env.HERDS_DB
    .prepare("SELECT room_id, title, body FROM news_drafts WHERE id = ?")
    .bind(id)
    .first<{ room_id: number; title: string; body: string }>();
  if (!draft) return c.json({ error: "draft not found" }, 404);

  const edits = await c.req.json<{ title?: string; body?: string }>().catch(() => null);
  const title = edits?.title?.trim() || draft.title;
  const body = edits?.body?.trim() || draft.body;
  if (title.length > MAX_NEWS_TITLE) return c.json({ error: "invalid title" }, 400);
  if (body.length > MAX_NEWS_BODY) return c.json({ error: "invalid body" }, 400);

  // one batch: the post appears and the draft disappears together
  const [inserted] = await c.env.HERDS_DB.batch([
    c.env.HERDS_DB
      .prepare(
        "INSERT INTO news (room_id, title, body) VALUES (?, ?, ?) RETURNING id, title, body, created_at",
      )
      .bind(draft.room_id, title, body),
    c.env.HERDS_DB.prepare("DELETE FROM news_drafts WHERE id = ?").bind(id),
  ]);

  return c.json(inserted.results[0], 201);
});

// Discard a draft
newsDraftsRoutes.delete("/admin/news-drafts/:id", admin, async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid id" }, 400);

  const result = await c.env.HERDS_DB.prepare("DELETE FROM news_drafts WHERE id = ?").bind(id).run();
  if (result.meta.changes === 0) return c.json({ error: "draft not found" }, 404);
  return c.body(null, 204);
});