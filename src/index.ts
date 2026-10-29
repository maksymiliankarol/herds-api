import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "./lib/env";
import { corsFromEnv } from "./middleware/cors";
import { rateLimit } from "./middleware/rate-limit";
import { citiesRoutes } from "./routes/cities";
import { messagesRoutes } from "./routes/messages";
import { newsRoutes } from "./routes/news";
import { roomsRoutes } from "./routes/rooms";
import { wsRoutes } from "./routes/ws";

// wrangler needs the Durable Object class exported from the entry file
export { Room } from "./room";

const app = new Hono<AppEnv>();

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  console.error("unhandled error", err); // shows up in observability
  return c.json({ error: "internal error" }, 500);
});

app.notFound((c) => c.json({ error: "not found" }, 404));

// The WebSocket upgrade is registered BEFORE the middleware below on purpose:
// it does its own origin, rate limit and Turnstile checks, and CORS doesn't apply to it.
app.route("/", wsRoutes);

app.use("*", corsFromEnv);
app.get("*", rateLimit("READ_LIMITER")); // every read; admin writes have their own limiter

app.route("/", citiesRoutes);
app.route("/", roomsRoutes);
app.route("/", messagesRoutes);
app.route("/", newsRoutes);

export default app;