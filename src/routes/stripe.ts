import { Hono } from "hono";
import type Stripe from "stripe";
import { getStripe } from "../lib/stripe";

const stripe = new Hono<{ Bindings: CloudflareBindings }>();

stripe.post("/webhook", async (c) => {
  const signature = c.req.header("stripe-signature");
  if (!signature) return c.json({ error: "Missing signature" }, 400);

  // The signature is checked against the raw body, so read it as text
  let event: Stripe.Event;
  try {
    event = await getStripe(c.env).webhooks.constructEventAsync(
      await c.req.text(),
      signature,
      c.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch {
    return c.json({ error: "Invalid signature" }, 400);
  }

  if (
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.async_payment_succeeded"
  ) {
    await finalize(c.env, event.data.object);
  }

  return c.json({ received: true });
});

async function finalize(env: CloudflareBindings, session: Stripe.Checkout.Session) {
  if (session.payment_status !== "paid") return;

  const id = Number(session.client_reference_id);
  if (!Number.isInteger(id)) return;

  // Queue the ad and mark the order paid, atomically. The insert only matches
  // an unpaid order, so on a Stripe retry (paid_at already set) it does nothing.
  const [insert] = await env.DB.batch([
    env.DB
      .prepare(
        `INSERT INTO news_queue (content, room_id, publish_at, is_ad)
        SELECT content, room_id, publish_at, 1
        FROM ad_orders WHERE id = ? AND stripe_session_id = ? AND paid_at IS NULL`
      )
      .bind(id, session.id),
    env.DB
      .prepare("UPDATE ad_orders SET paid_at = CURRENT_TIMESTAMP WHERE id = ? AND stripe_session_id = ? AND paid_at IS NULL")
      .bind(id, session.id),
  ]);

  if (insert.meta.changes === 0) {
    console.error(`Session ${session.id} moved nothing: duplicate delivery, or order gone (refund may be needed)`);
  }
}

export default stripe;