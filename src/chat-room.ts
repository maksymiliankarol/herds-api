import * as v from "valibot";
import { DurableObject } from "cloudflare:workers";
import { MessageSchema } from "./schema";

// Per-socket rate limit (token bucket)
const BURST = 5;
const REFILL_PER_SEC = 1;
const MAX_STRIKES = 5;

// Connection limits
const MAX_PER_ROOM = 100;
const MAX_PER_IP = 3;

// Dead connection check
const CHECK_MS = 30_000;
const TIMEOUT_MS = 60_000;

type Attachment = { username: string; ip: string; joined: number };
type Bucket = { tokens: number; last: number; strikes: number };

export class ChatRoom extends DurableObject<CloudflareBindings> {
  private buckets = new WeakMap<WebSocket, Bucket>();

  constructor(ctx: DurableObjectState, env: CloudflareBindings) {
    super(ctx, env);
    // Answered by the runtime without waking the object. Clients send the ping every ~25s.
    // Not plain "ping"/"pong", so a user typing that is not swallowed.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("__ping__", "__pong__"));
  }

  // --- Entry point: new WebSocket connection ---

  async fetch(request: Request) {
    const username = new URL(request.url).searchParams.get("username")!;
    const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
    const sockets = this.open().map((ws) => this.attachment(ws));

    if (sockets.length >= MAX_PER_ROOM) return this.reject(4503, "Room is full");
    if (sockets.filter((s) => s.ip === ip).length >= MAX_PER_IP) return this.reject(4290, "Too many connections");
    if (sockets.some((s) => s.username.toLowerCase() === username.toLowerCase())) return this.reject(4009, "Username taken");

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ username, ip, joined: Date.now() } satisfies Attachment);
    this.broadcast({ type: "online", count: this.open().length });

    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + CHECK_MS);
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  // --- Admin methods (called from the rooms route) ---

  users(): { username: string; ip: string }[] {
    return this.open().map((ws) => {
      const { username, ip } = this.attachment(ws);
      return { username, ip };
    });
  }

  // Closes matching sockets and returns their IPs, so the route can ban them
  kick(target: { username?: string; ip?: string }): string[] {
    const ips = new Set<string>();

    for (const ws of this.open()) {
      const s = this.attachment(ws);
      const sameIp = s.ip === target.ip;
      const sameName = s.username.toLowerCase() === target.username?.toLowerCase();

      if (sameIp || sameName) {
        ips.add(s.ip);
        ws.close(4403, "Removed by moderator");
      }
    }

    return [...ips];
  }

  async destroy() {
    for (const ws of this.ctx.getWebSockets()) ws.close(1001, "Room deleted");
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  // --- WebSocket handlers ---

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (!this.allow(ws)) return;

    const result = v.safeParse(MessageSchema, message);
    if (!result.success) {
      ws.send(JSON.stringify({ type: "error", error: "Invalid message" }));
      return;
    }

    const { username } = this.attachment(ws);
    this.broadcast({ type: "message", username, text: result.output });
  }

  webSocketClose(ws: WebSocket) {
    ws.close(1000);
    this.broadcast({ type: "online", count: this.open().length });
  }

  // Closes connections that stopped pinging (dropped network, closed laptop, ...)
  async alarm() {
    const cutoff = Date.now() - TIMEOUT_MS;
    let closed = false;

    for (const ws of this.open()) {
      const lastSeen =
        this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? this.attachment(ws).joined;

      if (lastSeen < cutoff) {
        ws.close(1001, "Timed out");
        closed = true;
      }
    }

    if (closed) this.broadcast({ type: "online", count: this.open().length });
    if (this.open().length > 0) await this.ctx.storage.setAlarm(Date.now() + CHECK_MS);
  }

  // --- Helpers ---

  // Token bucket: returns false (and warns or closes the socket) when the sender is too fast
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

  // Browsers can't read the status of a failed WebSocket handshake,
  // so we accept the connection and close it with a custom code (4000-4999)
  private reject(code: number, reason: string) {
    const { 0: client, 1: server } = new WebSocketPair();
    server.accept();
    server.close(code, reason);
    return new Response(null, { status: 101, webSocket: client });
  }

  private attachment(ws: WebSocket) {
    return ws.deserializeAttachment() as Attachment;
  }

  private open() {
    return this.ctx.getWebSockets().filter((ws) => ws.readyState === WebSocket.OPEN);
  }

  private broadcast(data: object) {
    const json = JSON.stringify(data);
    for (const ws of this.open()) ws.send(json);
  }
}