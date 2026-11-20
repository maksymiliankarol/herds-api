import { Hono } from "hono";
import { vValidator } from "@hono/valibot-validator";
import { NewsQueueSchema } from "../schema";
import { getStripe } from "../lib/stripe";
import { AD_PRICE } from "../lib/pricing";

// Stripe wants a session to live at least 30 min, so keep a margin
const SESSION_MINUTES = 31;

const ads = new Hono<{ Bindings: CloudflareBindings }>();

ads.post(
  "/",
  vValidator("json", NewsQueueSchema, (result, c) => {
    if (!result.success) return c.json({ error: result.issues[0].message }, 400);
  }),
  async (c) => {
    const { content, room_id, publish_at } = c.req.valid("json");

    // 1. Store the ad as an unpaid order
    let id: number;
    try {
      ({ id } = (await c.env.DB
        .prepare("INSERT INTO ad_orders (content, room_id, publish_at) VALUES (?, ?, ?) RETURNING id")
        .bind(content, room_id, publish_at)
        .first<{ id: number }>())!);
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