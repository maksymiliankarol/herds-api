import { Hono } from "hono";
import { vValidator } from "@hono/valibot-validator";
import { ADS_PER_DAY } from "../config";
import { NewsQuerySchema, NewsQueueSchema } from "../schema";
import { getStripe } from "../lib/stripe";
import { AD_PRICE } from "../lib/pricing";

// Stripe wants a session to live at least 30 min, so keep a margin
const SESSION_MINUTES = 31;

const ads = new Hono<{ Bindings: CloudflareBindings }>();

// Days that already have the maximum number of ads in this room
ads.get("/availability", vValidator("query", NewsQuerySchema), async (c) => {
  const { room_id } = c.req.valid("query");

  const { results } = await c.env.DB
    .prepare(
      `SELECT substr(publish_at, 1, 10) AS day FROM ad_orders
       WHERE room_id = ? AND publish_at > datetime('now')
       GROUP BY publish_at HAVING COUNT(*) >= ?`,
    )
    .bind(room_id, ADS_PER_DAY)
    .all<{ day: string }>();

  return c.json(results.map((r) => r.day));
});

ads.post(
  "/",
  vValidator("json", NewsQueueSchema, (result, c) => {
    if (!result.success) return c.json({ error: result.issues[0].message }, 400);
  }),
  async (c) => {
    const { content, room_id, publish_at } = c.req.valid("json");

    // 1. Store the ad as an unpaid order, unless the day is already full
    let id: number;
    try {
      const row = await c.env.DB
        .prepare(
          `INSERT INTO ad_orders (content, room_id, publish_at)
          SELECT ?1, ?2, ?3
          WHERE (SELECT COUNT(*) FROM ad_orders WHERE room_id = ?2 AND publish_at = ?3) < ?4
          RETURNING id`,
        )
        .bind(content, room_id, publish_at, ADS_PER_DAY)
        .first<{ id: number }>();
      if (!row) return c.json({ error: "This day is full" }, 409);
      id = row.id;
    } catch (e) {
      if (String(e).includes("FOREIGN KEY")) return c.json({ error: "Room not found" }, 404);
      throw e;
    }

    // 2. Create the checkout session; drop the order if anything fails
    try {
      const session = await getStripe(c.env).checkout.sessions.create({
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency: AD_PRICE.currency,
              unit_amount: AD_PRICE.amount,
              product_data: { name: "Herds ad" },
            },
            quantity: 1,
          },
        ],
        client_reference_id: String(id),
        expires_at: Math.floor(Date.now() / 1000) + SESSION_MINUTES * 60,
        success_url: `${c.env.WEB_URL}/success`,
        cancel_url: `${c.env.WEB_URL}/success?cancelled=1`,
      });

      await c.env.DB
        .prepare("UPDATE ad_orders SET stripe_session_id = ? WHERE id = ?")
        .bind(session.id, id)
        .run();

      return c.json({ url: session.url }, 201);
    } catch (e) {
      await c.env.DB.prepare("DELETE FROM ad_orders WHERE id = ?").bind(id).run();
      throw e;
    }
  },
);

export default ads;