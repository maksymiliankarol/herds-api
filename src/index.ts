import { Hono } from 'hono';
import cities from './routes/cities';
import rooms from './routes/rooms';
import chat from './routes/chat';
import { cors } from 'hono/cors';
import { rateLimit } from './middleware/rate-limit';
import news from './routes/news';

const app = new Hono<{ Bindings: CloudflareBindings }>();

app.onError((e, c) => {
  console.error(e);
  return c.json({ error: "Internal error" }, 500);
});

app.use(
  "/*",
  cors({
    origin: ["https://herds.metalogrom.com", "http://localhost:5173"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
    maxAge: 86400,
  }),
  rateLimit,
);

app.route("/cities", cities);
app.route("/rooms", rooms);
app.route("/chat", chat);
app.route("/news", news);

export { ChatRoom } from "./chat-room"
export default app;
