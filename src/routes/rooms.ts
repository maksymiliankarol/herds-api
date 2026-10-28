import { Hono } from "hono";
import type { AppEnv } from "../lib/env";
import { findRoomId, roomStub } from "../lib/rooms";
import { admin } from "../middleware/admin";
import { escapeLike } from "../lib/sql";

// "food", "long-room-name", "food_cheap", "long-room-name_sub-room"
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:_[a-z0-9]+(?:-[a-z0-9]+)*)?$/;
const MAX_SLUG = 40;

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

  if (!slug || slug.length > MAX_SLUG || !SLUG.test(slug)) return c.json({ error: "invalid slug" }, 400);
  if (!title) return c.json({ error: "title required" }, 400);

  const city = await c.env.herds_db
    .prepare("SELECT id FROM cities WHERE slug = ?")
    .bind(c.req.param("city"))
    .first<{ id: number }>();
  if (!city) return c.json({ error: "city not found" }, 404);

  const parent = slug.split("_")[1] !== undefined ? slug.split("_")[0] : null;
  if (parent) {
    const exists = await c.env.herds_db
      .prepare("SELECT 1 FROM rooms WHERE city_id = ? AND slug = ?")
      .bind(city.id, parent)
      .first();
    if (!exists) return c.json({ error: "parent room not found" }, 400);
  }

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

// Deleting a room also deletes its sub-rooms (slugs starting with "<slug>_")
roomsRoutes.delete("/cities/:city/rooms/:slug", admin, async (c) => {
  const slug = c.req.param("slug");

  // "_" is a LIKE wildcard, so it has to be escaped to match literally
  const childPattern = `${escapeLike(slug + "_")}%`;

  const { results } = await c.env.herds_db
    .prepare(
      `SELECT rooms.id, rooms.slug FROM rooms
       JOIN cities ON cities.id = rooms.city_id
       WHERE cities.slug = ?1
         AND (rooms.slug = ?2 OR rooms.slug LIKE ?3 ESCAPE '\\')`,
    )
    .bind(c.req.param("city"), slug, childPattern)
    .all<{ id: number; slug: string }>();

  // the room itself must exist; children alone don't count
  if (!results.some((r) => r.slug === slug)) return c.json({ error: "room not found" }, 404);

  // Wipe the objects first, then the rows. News rows go with them (ON DELETE CASCADE).
  for (const room of results) await roomStub(c.env, room.id).destroy();

  const ids = results.map((r) => r.id);
  await c.env.herds_db
    .prepare(`DELETE FROM rooms WHERE id IN (${ids.map(() => "?").join(",")})`)
    .bind(...ids)
    .run();

  return c.body(null, 204);
});