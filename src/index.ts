import { Hono } from "hono";
import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";
import { verifyTurnstile } from "./turnstile";

export { Room } from "./room";

const app = new Hono<{ Bindings: CloudflareBindings }>();

const SLUG = /^[a-z0-9-]{1,40}$/;
const MAX_NEWS_TITLE = 200;
const MAX_NEWS_BODY = 5000;
const CLOSE_VERIFICATION_FAILED = 4403;

// --- Helpers ---

const encoder = new TextEncoder();

// Hash both sides so the buffers have equal length, then compare in constant time
async function safeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(ha, hb);
}

const admin = createMiddleware<{ Bindings: CloudflareBindings }>(async (c, next) => {
  const { success } = await c.env.ADMIN_LIMITER.limit({ key: clientKey(c.req.raw) });
  if (!success) {
    return c.json({ error: "too many requests" }, 429, { "Retry-After": "60" });
  }

  const expected = c.env.ADMIN_TOKEN;
  if (!expected) return c.json({ error: "admin not configured" }, 500); // fail closed

  const match = c.req.header("Authorization")?.match(/^Bearer (.+)$/);
  if (!match || !(await safeEqual(match[1], expected))) {
    return c.json({ error: "unauthorized" }, 401, {
      "WWW-Authenticate": 'Bearer realm="admin"',
    });
  }

  await next();
});

// Escape LIKE wildcards so a search for "100%" or "a_b" is treated literally
const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&");

// Cloudflare sets this header, so clients can't spoof it. Locally it may be missing,
// which just means all dev requests share one key.
const clientKey = (req: Request) => req.headers.get("CF-Connecting-IP") ?? "unknown";

// Finish the upgrade, send an event, close with a code: a browser can't read the
// status of a failed handshake, but it can read a close code.
function rejectUpgrade(code: number, reason: string): Response {
  const { 0: client, 1: server } = new WebSocketPair();
  server.accept();
  server.send(JSON.stringify({ type: "rejected", code, error: reason }));
  server.close(code, reason);
  return new Response(null, { status: 101, webSocket: client });
}

// city slug + room slug -> numeric room id (null if either doesn't exist)
async function findRoomId(db: D1Database, city: string, slug: string): Promise<number | null> {
  const row = await db
    .prepare(
      `SELECT rooms.id FROM rooms
       JOIN cities ON cities.id = rooms.city_id
       WHERE cities.slug = ? AND rooms.slug = ?`,
    )
    .bind(city, slug)
    .first<{ id: number }>();
  return row?.id ?? null;
}

// The Durable Object is addressed by the room's immutable numeric id
const roomStub = (env: CloudflareBindings, id: number) => env.ROOM.getByName(String(id));

// --- WebSocket upgrade: registered BEFORE the cors middleware on purpose ---

app.get("/cities/:city/rooms/:slug/ws", async (c) => {
  if (c.req.header("Upgrade") !== "websocket") {
    return c.text("Expected WebSocket", 426);
  }

  const { success } = await c.env.WS_LIMITER.limit({ key: clientKey(c.req.raw) });
  if (!success) return c.text("Too many requests", 429, { "Retry-After": "60" });

  // CORS doesn't protect WebSockets, so check the Origin yourself
  const origin = c.req.header("Origin");
  if (origin && origin !== c.env.WEB_URL) return c.text("Forbidden", 403);

  // a Turnstile token is single-use, so every connect needs a fresh one
  if (!c.env.TURNSTILE_SECRET) return c.text("Not configured", 500); // fail closed
  const token = c.req.query("token") ?? "";
  const human = await verifyTurnstile(token, c.env.TURNSTILE_SECRET, c.req.header("CF-Connecting-IP"));
  if (!human) return rejectUpgrade(CLOSE_VERIFICATION_FAILED, "verification failed");

  const id = await findRoomId(c.env.herds_db, c.req.param("city"), c.req.param("slug"));
  if (id === null) return c.json({ error: "room not found" }, 404);

  // the Room doesn't need the token: strip it before forwarding
  const url = new URL(c.req.url);
  url.searchParams.delete("token");
  return roomStub(c.env, id).fetch(new Request(url, c.req.raw));
});

app.use(
  "*",
  (c, next) =>
    cors({ origin: c.env.WEB_URL, allowMethods: ["GET", "POST", "DELETE"] })(c, next),
);

// --- Cities ---

// GET /cities?q=krak
app.get("/cities", async (c) => {
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

// --- Rooms (registry in D1) ---

app.get("/cities/:city/rooms", async (c) => {
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

app.post("/cities/:city/rooms", admin, async (c) => {
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

app.delete("/cities/:city/rooms/:slug", admin, async (c) => {
  const id = await findRoomId(c.env.herds_db, c.req.param("city"), c.req.param("slug"));
  if (id === null) return c.json({ error: "room not found" }, 404);

  // Wipe the object first, then the row. News rows go with it (ON DELETE CASCADE).
  await roomStub(c.env, id).destroy();
  await c.env.herds_db.prepare("DELETE FROM rooms WHERE id = ?").bind(id).run();

  return c.body(null, 204);
});

// --- Messages (Durable Object). They can only be posted through the WebSocket. ---

app.get("/cities/:city/rooms/:slug/messages", async (c) => {
  const id = await findRoomId(c.env.herds_db, c.req.param("city"), c.req.param("slug"));
  if (id === null) return c.json({ error: "room not found" }, 404);
  return c.json(await roomStub(c.env, id).listMessages());
});

// --- News (D1, written by admin) ---

app.get("/cities/:city/rooms/:slug/news", async (c) => {
  const id = await findRoomId(c.env.herds_db, c.req.param("city"), c.req.param("slug"));
  if (id === null) return c.json({ error: "room not found" }, 404);

  const { results } = await c.env.herds_db
    .prepare(
      `SELECT id, title, body, created_at FROM news
       WHERE room_id = ? ORDER BY created_at DESC, id DESC LIMIT 50`,
    )
    .bind(id)
    .all();

  return c.json(results);
});

app.post("/cities/:city/rooms/:slug/news", admin, async (c) => {
  const data = await c.req.json<{ title?: string; body?: string }>().catch(() => null);
  const title = data?.title?.trim();
  const body = data?.body?.trim();

  if (!title || title.length > MAX_NEWS_TITLE) return c.json({ error: "invalid title" }, 400);
  if (!body || body.length > MAX_NEWS_BODY) return c.json({ error: "invalid body" }, 400);

  const id = await findRoomId(c.env.herds_db, c.req.param("city"), c.req.param("slug"));
  if (id === null) return c.json({ error: "room not found" }, 404);

  const item = await c.env.herds_db
    .prepare(
      "INSERT INTO news (room_id, title, body) VALUES (?, ?, ?) RETURNING id, title, body, created_at",
    )
    .bind(id, title, body)
    .first();

  return c.json(item, 201);
});

app.delete("/cities/:city/rooms/:slug/news/:id", admin, async (c) => {
  const newsId = Number(c.req.param("id"));
  if (!Number.isInteger(newsId)) return c.json({ error: "invalid id" }, 400);

  const roomId = await findRoomId(c.env.herds_db, c.req.param("city"), c.req.param("slug"));
  if (roomId === null) return c.json({ error: "room not found" }, 404);

  // scoped to the room, so an id from another room can't be deleted through this URL
  const result = await c.env.herds_db
    .prepare("DELETE FROM news WHERE id = ? AND room_id = ?")
    .bind(newsId, roomId)
    .run();

  if (result.meta.changes === 0) return c.json({ error: "news not found" }, 404);
  return c.body(null, 204);
});


export default app;