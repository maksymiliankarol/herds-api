import * as v from "valibot";
import { DurableObject } from "cloudflare:workers";
import { MessageSchema } from "./schema";

const BURST = 5;
const REFILL_PER_SEC = 1;
const MAX_STRIKES = 5;
const MAX_PER_ROOM = 100;
const MAX_PER_IP = 3;
const CHECK_MS = 30_000;
const TIMEOUT_MS = 60_000;

export class ChatRoom extends DurableObject<CloudflareBindings> {
  private buckets = new WeakMap<WebSocket, { tokens: number; last: number; strikes: number }>();

  constructor(ctx: DurableObjectState, env: CloudflareBindings) {
    super(ctx, env);
    // Answered by the runtime without waking the object. Clients send the ping every ~25s.
    // Not plain "ping"/"pong", so a user typing that is not swallowed.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("__ping__", "__pong__"));
  }

  async fetch(request: Request) {
    const username = new URL(request.url).searchParams.get("username")!;
    const ip = request.headers.get("cf-connecting-ip") ?? "unknown";

    const sockets = this.open().map((ws) => ws.deserializeAttachment());

    if (sockets.length >= MAX_PER_ROOM) return this.reject(4503, "Room is full");
    if (sockets.filter((s) => s.ip === ip).length >= MAX_PER_IP) return this.reject(4290, "Too many connections");
    if (sockets.some((s) => s.username.toLowerCase() === username.toLowerCase())) return this.reject(4009, "Username taken");

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ username, ip, joined: Date.now() });
    this.broadcast({ type: "online", count: this.online() });

    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + CHECK_MS);
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  // Browsers can't read the status of a failed WebSocket handshake,
  // so we accept the connection and close it with a custom code (4000-4999)
  private reject(code: number, reason: string) {
    const { 0: client, 1: server } = new WebSocketPair();
    server.accept();
    server.close(code, reason);
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (!this.allow(ws)) return;

    const result = v.safeParse(MessageSchema, message);
    if (!result.success) {
      ws.send(JSON.stringify({ type: "error", error: "Invalid message" }));
      return;
    }

    const { username } = ws.deserializeAttachment();
    this.broadcast({ type: "message", username, text: result.output });
  }

  private allow(ws: WebSocket): boolean {
    const now = Date.now();
    const b = this.buckets.get(ws) ?? { tokens: BURST, last: now, strikes: 0 };
    this.buckets.set(ws, b);

    b.tokens = Math.min(BURST, b.tokens + ((now - b.last) / 1000) * REFILL_PER_SEC);
    b.last = now;

    if (b.tokens >= 1) {
      b.tokens -= 1;
      return true;
    }

    if (++b.strikes >= MAX_STRIKES) {
      ws.close(1008, "Rate limit exceeded");
    } else {
      ws.send(JSON.stringify({ type: "error", error: "Slow down" }));
    }
    return false;
  }

  webSocketClose(ws: WebSocket) {
    ws.close(1000);
    this.broadcast({ type: "online", count: this.online() });
  }

  // Closes connections that stopped pinging (dropped network, closed laptop, ...)
  async alarm() {
    const cutoff = Date.now() - TIMEOUT_MS;
    let closed = false;

    for (const ws of this.open()) {
      const lastSeen =
        this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? ws.deserializeAttachment().joined;
      if (lastSeen < cutoff) {
        ws.close(1001, "Timed out");
        closed = true;
      }
    }

    if (closed) this.broadcast({ type: "online", count: this.online() });
    if (this.open().length > 0) await this.ctx.storage.setAlarm(Date.now() + CHECK_MS);
  }

  // Called by the rooms route when an admin deletes the room
  async destroy() {
    for (const ws of this.ctx.getWebSockets()) ws.close(1001, "Room deleted");
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  private open() {
    return this.ctx.getWebSockets().filter((ws) => ws.readyState === WebSocket.OPEN);
  }

  private online() {
    return this.open().length;
  }

  private broadcast(data: object) {
    const json = JSON.stringify(data);
    for (const ws of this.open()) ws.send(json);
  }
}