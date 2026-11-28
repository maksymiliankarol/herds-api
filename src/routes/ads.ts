import { Hono } from "hono";
import { vValidator } from "@hono/valibot-validator";
import { AD_LIFETIME_DAYS } from "../config";
import { AdsQuerySchema, IdParamSchema, NewAdSchema } from "../schema";
import { admin } from "../middleware/admin";
import { getStripe } from "../lib/stripe";
import { getAdPrice } from "../lib/pricing";

// Stripe wants a session to live at least 30 min, so keep a margin
const SESSION_MINUTES = 31;

const ads = new Hono<{ Bindings: CloudflareBindings }>();

// The ad pinned in this room right now, or null
ads.get("/", vValidator("query", AdsQuerySchema), async (c) => {
  const { room_id } = c.req.valid("query");

  const ad = await c.env.DB
    .prepare(
      // GET /
      `SELECT id, content, url, url_text FROM ads
      WHERE room_id = ? AND paid_at IS NOT NULL
        AND publish_at <= datetime('now') AND publish_at > datetime('now', ?)`
    )
    .bind(room_id, `-${AD_LIFETIME_DAYS} days`)
    .first();

  return c.json(ad);
});

// Days that are already taken in this room
ads.get("/availability", vValidator("query", AdsQuerySchema), async (c) => {
  const { room_id } = c.req.valid("query");

  const { results } = await c.env.DB
    .prepare("SELECT substr(publish_at, 1, 10) AS day FROM ads WHERE room_id = ? AND publish_at > datetime('now')")
    .bind(room_id)
    .all<{ day: string }>();

  return c.json(results.map((r) => r.day));
});

// Price of an ad in this room (depends on the country of the room's city)
ads.get("/price", vValidator("query", AdsQuerySchema), async (c) => {
  const { room_id } = c.req.valid("query");

  const price = await getAdPrice(c.env.DB, room_id);
  if (!price) return c.json({ error: "Room not found" }, 404);

  return c.json(price);
});

ads.post(
  "/",
  vValidator("json", NewAdSchema, (result, c) => {
    if (!result.success) return c.json({ error: result.issues[0].message }, 400);
  }),
  async (c) => {
    const { content, url, url_text, room_id, publish_at } = c.req.valid("json");

    // The price comes from the room, never from the client
    const price = await getAdPrice(c.env.DB, room_id);
    if (!price) return c.json({ error: "Room not found" }, 404);

    // 1. Store the ad as an unpaid order. The unique (room_id, publish_at) index holds the slot.
    let id: number;
    try {
      const row = await c.env.DB
        .prepare("INSERT INTO ads (content, url, url_text, room_id, publish_at) VALUES (?, ?, ?, ?, ?) RETURNING id")
        .bind(content, url, url_text, room_id, publish_at)
        .first<{ id: number }>();
      id = row!.id;
    } catch (e) {
      if (String(e).includes("UNIQUE")) return c.json({ error: "This day is taken" }, 409);
      throw e;
    }

    // 2. Create the checkout session; drop the order if anything fails
    try {
      const session = await getStripe(c.env).checkout.sessions.create({
        mode: "payment",
        // Charge exactly the price the site showed, with no automatic conversion
        adaptive_pricing: { enabled: false },
        line_items: [
          {
            price_data: {
              currency: price.currency,
              unit_amount: price.amount,
              product_data: { name: "Herds ad" },
            },
            quantity: 1,
          },
        ],
        client_reference_id: String(id),
        expires_at: Math.floor(Date.now() / 1000) + SESSION_MINUTES * 60,
        success_url: `${c.env.WEB_URL_ADS}/success`,
        cancel_url: `${c.env.WEB_URL_ADS}/success?cancelled=1`,
      });

      await c.env.DB
        .prepare("UPDATE ads SET stripe_session_id = ? WHERE id = ?")
        .bind(session.id, id)
        .run();

      return c.json({ url: session.url }, 201);
    } catch (e) {
      await c.env.DB.prepare("DELETE FROM ads WHERE id = ?").bind(id).run();
      throw e;
    }
  },
);

// Admin: take an ad down (moderation)
ads.delete("/:id", admin, vValidator("param", IdParamSchema), async (c) => {
  const { id } = c.req.valid("param");

  const { meta } = await c.env.DB.prepare("DELETE FROM ads WHERE id = ?").bind(id).run();
  if (meta.changes === 0) return c.json({ error: "Not found" }, 404);

  return c.body(null, 204);
});

export default ads;