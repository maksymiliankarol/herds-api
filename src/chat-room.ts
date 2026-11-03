import * as v from "valibot";
import { DurableObject } from "cloudflare:workers";
import { MessageSchema } from "./schema";

const BURST = 5;
const REFILL_PER_SEC = 1;
const MAX_STRIKES = 5;
const MAX_PER_ROOM = 100;
const MAX_PER_IP = 3;

export class ChatRoom extends DurableObject<CloudflareBindings> {
  private buckets = new WeakMap<WebSocket, { tokens: number; last: number; strikes: number }>();

  async fetch(request: Request) {
    const username = new URL(request.url).searchParams.get("username")!;
    const ip = request.headers.get("cf-connecting-ip") ?? "unknown";

    const sockets = this.ctx.getWebSockets().map((ws) => ws.deserializeAttachment());

    if (sockets.length >= MAX_PER_ROOM) {
      return Response.json({ error: "Room is full" }, { status: 503 });
    }
    if (sockets.filter((s) => s.ip === ip).length >= MAX_PER_IP) {
      return Response.json({ error: "Too many connections" }, { status: 429 });
    }
    if (sockets.some((s) => s.username.toLowerCase() === username.toLowerCase())) {
      return Response.json({ error: "Username taken" }, { status: 409 });
    }

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ username, ip });
    this.broadcast({ type: "join", username });

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

  webSocketClose(ws: WebSocket, code: number, reason: string) {
    ws.close(code, reason);
    this.broadcast({ type: "leave", username: ws.deserializeAttachment().username });
  }

  // Called by the rooms route when an admin deletes the room
  async destroy() {
    for (const ws of this.ctx.getWebSockets()) ws.close(1001, "Room deleted");
    await this.ctx.storage.deleteAll();
  }

  private broadcast(data: object) {
    const json = JSON.stringify(data);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.readyState === WebSocket.OPEN) ws.send(json);
    }
  }
}