import { Hono } from "hono";
import type { AppEnv } from "../lib/env";
import { escapeLike } from "../lib/sql";
import { admin } from "../middleware/admin";
import { roomStub } from "../lib/rooms";

const SLUG = /^[a-z0-9-]{1,40}$/;
const CODE = /^[a-z]{2}$/;

export const citiesRoutes = new Hono<AppEnv>();

// GET /cities?q=krak
citiesRoutes.get("/cities", async (c) => {
  const q = (c.req.query("q") ?? "").trim().slice(0, 50);
  const pattern = `%${escapeLike(q)}%`;

  const { results } = await c.env.herds_db
    .prepare(
      `SELECT cities.slug, cities.name,
              cities.country AS country_code, countries.name AS country_name
       FROM cities
       JOIN countries ON countries.code = cities.country
       WHERE cities.name LIKE ?1 ESCAPE '\\' OR cities.slug LIKE ?1 ESCAPE '\\'
       ORDER BY cities.name
       LIMIT 20`,
    )
    .bind(pattern)
    .all();

  return c.json(results);
});

// POST /cities  { "slug": "gdansk", "name": "Gdansk", "country": "pl" }
citiesRoutes.post("/cities", admin, async (c) => {
  const data = await c.req
    .json<{ slug?: string; name?: string; country?: string }>()
    .catch(() => null);
  const slug = data?.slug;
  const name = data?.name?.trim();
  const country = data?.country?.trim().toLowerCase();

  if (!slug || !SLUG.test(slug)) return c.json({ error: "invalid slug" }, 400);
  if (!name || name.length > 100) return c.json({ error: "invalid name" }, 400);
  if (!country || !CODE.test(country)) return c.json({ error: "invalid country" }, 400);

  const known = await c.env.herds_db
    .prepare("SELECT code FROM countries WHERE code = ?")
    .bind(country)
    .first();
  if (!known) return c.json({ error: "country not found" }, 404);

  // RETURNING gives no row when the conflict clause skips the insert
  const city = await c.env.herds_db
    .prepare(
      `INSERT INTO cities (slug, name, country) VALUES (?, ?, ?)
       ON CONFLICT (slug) DO NOTHING
       RETURNING slug, name, country`,
    )
    .bind(slug, name, country)
    .first();

  if (!city) return c.json({ error: "city exists" }, 409);
  return c.json(city, 201);
});

// POST /countries  { "code": "de", "name": "Germany" }
citiesRoutes.post("/countries", admin, async (c) => {
  const data = await c.req.json<{ code?: string; name?: string }>().catch(() => null);
  const code = data?.code?.trim().toLowerCase();
  const name = data?.name?.trim();

  if (!code || !CODE.test(code)) return c.json({ error: "invalid code" }, 400);
  if (!name || name.length > 100) return c.json({ error: "invalid name" }, 400);

  // RETURNING gives no row when the conflict clause skips the insert
  const country = await c.env.herds_db
    .prepare(
      `INSERT INTO countries (code, name) VALUES (?, ?)
       ON CONFLICT (code) DO NOTHING
       RETURNING code, name`,
    )
    .bind(code, name)
    .first();

  if (!country) return c.json({ error: "country exists" }, 409);
  return c.json(country, 201);
});

// DELETE /cities/:city: wipes every room's Durable Object, then the city (rooms and news cascade)
citiesRoutes.delete("/cities/:city", admin, async (c) => {
  const city = await c.env.herds_db
    .prepare("SELECT id FROM cities WHERE slug = ?")
    .bind(c.req.param("city"))
    .first<{ id: number }>();
  if (!city) return c.json({ error: "city not found" }, 404);

  const { results } = await c.env.herds_db
    .prepare("SELECT id FROM rooms WHERE city_id = ?")
    .bind(city.id)
    .all<{ id: number }>();

  // Durable Object storage is not covered by ON DELETE CASCADE
  for (const room of results) await roomStub(c.env, room.id).destroy();

  await c.env.herds_db.prepare("DELETE FROM cities WHERE id = ?").bind(city.id).run();
  return c.body(null, 204);
});

// DELETE /countries/:code: refused while it still has cities
citiesRoutes.delete("/countries/:code", admin, async (c) => {
  const code = c.req.param("code").toLowerCase();

  const used = await c.env.herds_db
    .prepare("SELECT COUNT(*) AS n FROM cities WHERE country = ?")
    .bind(code)
    .first<{ n: number }>();
  if ((used?.n ?? 0) > 0) return c.json({ error: "country has cities" }, 409);

  const result = await c.env.herds_db
    .prepare("DELETE FROM countries WHERE code = ?")
    .bind(code)
    .run();
  if (result.meta.changes === 0) return c.json({ error: "country not found" }, 404);

  return c.body(null, 204);
});