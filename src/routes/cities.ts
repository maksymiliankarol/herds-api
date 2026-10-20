import { Hono } from "hono";
import type { AppEnv } from "../lib/env";
import { escapeLike } from "../lib/sql";

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