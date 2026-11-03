import { Hono } from 'hono';
import cities from './routes/cities';
import rooms from './routes/rooms';
import chat from './routes/chat';

const app = new Hono<{ Bindings: CloudflareBindings }>();

app.route("/cities", cities);
app.route("/rooms", rooms);
app.route("/chat", chat);

export { ChatRoom } from "./chat-room"
export default app;
