import { Hono } from "hono";
import { vValidator } from "@hono/valibot-validator";
import { RoomSchema, IdParamSchema, RoomsQuerySchema, KickSchema } from "../schema";
import { admin } from "../middleware/admin";

const rooms = new Hono<{ Bindings: CloudflareBindings }>();

const roomStub = (env: CloudflareBindings, id: number) =>
  env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName(String(id)));

// Public

rooms.get("/", vValidator("query", RoomsQuerySchema), async (c) => {
  const { city_id } = c.req.valid("query");

  const { results } = await c.env.DB
    .prepare("SELECT id, title, created_at FROM rooms WHERE city_id = ? ORDER BY created_at DESC LIMIT 100")
    .bind(city_id)
    .all();

  return c.json(results);
});

// Admin

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
    if (String(e).includes("UNIQUE")) {
      return c.json({ error: "Room already exists" }, 409);
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

    await roomStub(c.env, id).destroy();

    return c.body(null, 204);
  } catch (e) {
    if (String(e).includes("FOREIGN KEY")) {
      return c.json({ error: "Room still has news" }, 409);
    }
    throw e;
  }
});

rooms.get("/:id/users", admin, vValidator("param", IdParamSchema), async (c) => {
  const { id } = c.req.valid("param");
  return c.json(await roomStub(c.env, id).users());
});

rooms.post("/:id/kick", admin, vValidator("param", IdParamSchema), vValidator("json", KickSchema), async (c) => {
  const { id } = c.req.valid("param");
  const { ban_hours, ...target } = c.req.valid("json");

  const ips = await roomStub(c.env, id).kick(target);

  if (ban_hours && ips.length > 0) {
    await c.env.DB.batch(
      ips.map((ip) =>
        c.env.DB
          .prepare("INSERT OR REPLACE INTO bans (ip, expires_at) VALUES (?, datetime('now', ?))")
          .bind(ip, `+${ban_hours} hours`),
      ),
    );
  }

  return c.json({ ips });
});

export default rooms;