import { Hono } from "hono";
import type { AppEnv } from "../lib/env";
import { findRoomId, roomStub } from "../lib/rooms";
import { admin } from "../middleware/admin";

const SLUG = /^[a-z0-9-]{1,40}$/;

// Room registry (D1). The live chat state lives in the Durable Object.
export const roomsRoutes = new Hono<AppEnv>();

roomsRoutes.get("/cities/:city/rooms", async (c) => {
  const city = await c.env.herds_db
    .prepare("SELECT id, slug, name FROM cities WHERE slug = ?")
    .bind(c.req.param("city"))
    .first<{ id: number; slug: string; name: string }>();
  if (!city) return c.json({ error: "city not found" }, 404);

  const { results } = await c.env.herds_db
    .prepare("SELECT slug, title FROM rooms WHERE city_id = ? ORDER BY title")
    .bind(city.id)
    .all();

  return c.json({ city: { slug: city.slug, name: city.name }, rooms: results });
});

roomsRoutes.post("/cities/:city/rooms", admin, async (c) => {
  const data = await c.req.json<{ slug?: string; title?: string }>().catch(() => null);
  const slug = data?.slug;
  const title = data?.title?.trim();

  if (!slug || !SLUG.test(slug)) return c.json({ error: "invalid slug" }, 400);
  if (!title) return c.json({ error: "title required" }, 400);

  const city = await c.env.herds_db
    .prepare("SELECT id FROM cities WHERE slug = ?")
    .bind(c.req.param("city"))
    .first<{ id: number }>();
  if (!city) return c.json({ error: "city not found" }, 404);

  // RETURNING gives no row when the conflict clause skips the insert
  const room = await c.env.herds_db
    .prepare(
      `INSERT INTO rooms (city_id, slug, title) VALUES (?, ?, ?)
       ON CONFLICT (city_id, slug) DO NOTHING
       RETURNING slug, title`,
    )
    .bind(city.id, slug, title)
    .first<{ slug: string; title: string }>();

  if (!room) return c.json({ error: "room exists" }, 409);
  return c.json(room, 201);
});

roomsRoutes.delete("/cities/:city/rooms/:slug", admin, async (c) => {
  const id = await findRoomId(c.env.herds_db, c.req.param("city"), c.req.param("slug"));
  if (id === null) return c.json({ error: "room not found" }, 404);

  // Wipe the object first, then the row. News rows go with it (ON DELETE CASCADE).
  await roomStub(c.env, id).destroy();
  await c.env.herds_db.prepare("DELETE FROM rooms WHERE id = ?").bind(id).run();

  return c.body(null, 204);
});