import { Hono } from "hono";
import { vValidator } from "@hono/valibot-validator";
import { CitySchema, CitySearchSchema, IdParamSchema } from "../schema";
import { admin } from "../middleware/admin";

const cities = new Hono<{ Bindings: CloudflareBindings }>();

// Is it correct and efficient?
cities.get("/", vValidator("query", CitySearchSchema), async (c) => {
  const { q } = c.req.valid("query");
  const like = `%${q}%`;

  const { results } = await c.env.DB
    .prepare("SELECT id, city, city_label, country_code FROM cities WHERE city LIKE ? OR city_label LIKE ? ORDER BY city_label LIMIT 20")
    .bind(like, like)
    .all();

  return c.json(results);
});

cities.post("/", admin, vValidator("json", CitySchema), async (c) => {
  const { city, city_label, country_code } = c.req.valid("json");

  try {
    const row = await c.env.DB
      .prepare("INSERT INTO cities (city, city_label, country_code) VALUES (?, ?, ?) RETURNING *")
      .bind(city, city_label, country_code)
      .first();
    return c.json(row, 201);
  } catch (e) {
    if (String(e).includes("UNIQUE")) {
      return c.json({ error: "City already exists" }, 409);
    }
    throw e;
  }
});

cities.delete("/:id", admin, vValidator("param", IdParamSchema), async (c) => {
  const { id } = c.req.valid("param");

  try {
    const { meta } = await c.env.DB
      .prepare("DELETE FROM cities WHERE id = ?")
      .bind(id)
      .run();
    if (meta.changes === 0) return c.json({ error: "Not found" }, 404);
    return c.body(null, 204);
  } catch (e) {
    if (String(e).includes("FOREIGN KEY")) {
      return c.json({ error: "City still has rooms" }, 409);
    }
    throw e;
  }
});

export default cities;