import { Hono } from "hono";
import { vValidator } from "@hono/valibot-validator";
import { RoomSchema, IdParamSchema, RoomsQuerySchema } from "../schema";
import { admin } from "../middleware/admin";

const rooms = new Hono<{ Bindings: CloudflareBindings }>();

rooms.get("/", vValidator("query", RoomsQuerySchema), async (c) => {
  const { city_id } = c.req.valid("query");

  const { results } = await c.env.DB
    .prepare("SELECT id, title, created_at FROM rooms WHERE city_id = ? ORDER BY created_at DESC LIMIT 100")
    .bind(city_id)
    .all();

  return c.json(results);
});

rooms.post("/", admin, vValidator("json", RoomSchema), async (c) => {
  const { title, city_id } = c.req.valid("json");

  try {
    const row = await c.env.DB
      .prepare("INSERT INTO rooms (title, city_id) VALUES (?, ?) RETURNING *")
      .bind(title, city_id)
      .first();
    return c.json(row, 201);
  } catch (e) {
    if (String(e).includes("FOREIGN KEY")) {
      return c.json({ error: "City not found" }, 404);
    }
    throw e;
  }
});

rooms.delete("/:id", admin, vValidator("param", IdParamSchema), async (c) => {
  const { id } = c.req.valid("param");

  try {
    const { meta } = await c.env.DB
      .prepare("DELETE FROM rooms WHERE id = ?")
      .bind(id)
      .run();
    if (meta.changes === 0) return c.json({ error: "Not found" }, 404);

    const stub = c.env.CHAT_ROOM.get(c.env.CHAT_ROOM.idFromName(String(id)));
    await stub.destroy();

    return c.body(null, 204);
  } catch (e) {
    if (String(e).includes("FOREIGN KEY")) {
      return c.json({ error: "Room still has news" }, 409);
    }
    throw e;
  }
});

export default rooms;