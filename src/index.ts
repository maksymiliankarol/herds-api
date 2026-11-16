import { Hono } from "hono";
import { cors } from "hono/cors";
import { ALLOWED_ORIGINS } from "./config";
import { rateLimit } from "./middleware/rate-limit";
import cities from "./routes/cities";
import rooms from "./routes/rooms";
import chat from "./routes/chat";
import news from "./routes/news";

const app = new Hono<{ Bindings: CloudflareBindings }>();

app.onError((e, c) => {
  console.error(e);
  return c.json({ error: "Internal error" }, 500);
});

app.use(
  "/*",
  cors({
    origin: ALLOWED_ORIGINS,
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400,
  }),
  rateLimit,
);

app.route("/cities", cities);
app.route("/rooms", rooms);
app.route("/chat", chat);
app.route("/news", news);

export { ChatRoom } from "./chat-room";
export default app;