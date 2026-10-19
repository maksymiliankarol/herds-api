import { DurableObject } from "cloudflare:workers";

export type Message = { id: number; author: string; body: string; created_at: number };

type ServerEvent =
  | { type: "history"; messages: Message[] }
  | { type: "message"; message: Message }
  | { type: "error"; error: string }
  | { type: "rejected"; code: number; error: string };

// tokens/at are optional because sockets opened before the limiter existed have neither
type Attachment = { name: string; tokens?: number; at?: number };

const MAX_BODY = 2000;
const MAX_FRAME = 4096; // raw frame size, checked before parsing
const NAME = /^[\p{L}\p{N}_-]{2,20}$/u;

// Message rate limit per socket: bursts of 5, then 1 message per second
const BURST = 5;
const REFILL_MS = 1000;
const MAX_CONNECTIONS = 200;

// Custom close codes (4000-4999 are reserved for applications)
const CLOSE_INVALID_NAME = 4400;
const CLOSE_NAME_TAKEN = 4409;
const CLOSE_ROOM_FULL = 4429;

export class Room extends DurableObject<CloudflareBindings> {
  constructor(ctx: DurableObjectState, env: CloudflareBindings) {
    super(ctx, env);
    this.#initSchema();
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  #initSchema() {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        author TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
  }

  #send(ws: WebSocket, event: ServerEvent) {
    ws.send(JSON.stringify(event));
  }

  #broadcast(event: ServerEvent) {
    const payload = JSON.stringify(event);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(payload);
      } catch {
        // socket is already closing, ignore
      }
    }
  }

  #nameTaken(name: string): boolean {
    const lower = name.toLowerCase();
    return this.ctx.getWebSockets().some((ws) => {
      const attachment = ws.deserializeAttachment() as Attachment | null;
      return attachment?.name.toLowerCase() === lower;
    });
  }

  // Token bucket kept in the socket attachment, so it survives hibernation.
  // Returns false when the socket is over its limit.
  #takeToken(ws: WebSocket, a: Attachment): boolean {
    const now = Date.now();
    const elapsed = Math.max(0, now - (a.at ?? now));
    const tokens = Math.min(BURST, (a.tokens ?? BURST) + elapsed / REFILL_MS);
    const allowed = tokens >= 1;

    ws.serializeAttachment({
      ...a,
      tokens: allowed ? tokens - 1 : tokens,
      at: now,
    } satisfies Attachment);

    return allowed;
  }

  // Browsers can't read the status of a failed WebSocket handshake, so instead of
  // answering 400/409 we complete the upgrade, send an error event and close with a code.
  #reject(code: number, reason: string): Response {
    const { 0: client, 1: server } = new WebSocketPair();
    server.accept(); // plain accept: this socket isn't worth hibernating
    this.#send(server, { type: "rejected", code, error: reason });
    server.close(code, reason);
    return new Response(null, { status: 101, webSocket: client });
  }

  // --- RPC methods ---

  addMessage(author: string, body: string): Message {
    const message = this.ctx.storage.sql
      .exec<Message>(
        "INSERT INTO messages (author, body, created_at) VALUES (?, ?, ?) RETURNING id, author, body, created_at",
        author,
        body,
        Date.now(),
      )
      .one();
    this.#broadcast({ type: "message", message });
    return message;
  }

  listMessages(limit = 50): Message[] {
    return this.ctx.storage.sql
      .exec<Message>(
        "SELECT id, author, body, created_at FROM messages ORDER BY id DESC LIMIT ?",
        limit,
      )
      .toArray()
      .reverse();
  }

  async destroy(): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      ws.close(1001, "room deleted");
    }
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.#initSchema();
  }

  // --- WebSocket handling ---

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    if (this.ctx.getWebSockets().length >= MAX_CONNECTIONS) {
      return this.#reject(CLOSE_ROOM_FULL, "room full");
    }

    const name = new URL(request.url).searchParams.get("name")?.trim() ?? "";
    if (!NAME.test(name)) return this.#reject(CLOSE_INVALID_NAME, "invalid name");
    if (this.#nameTaken(name)) return this.#reject(CLOSE_NAME_TAKEN, "name taken");

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ name, tokens: BURST, at: Date.now() } satisfies Attachment);
    this.#send(server, { type: "history", messages: this.listMessages() });

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== "string") return;

    const attachment = ws.deserializeAttachment() as Attachment | null;
    if (!attachment) return;

    // cheapest checks first, so a flood costs as little as possible
    if (!this.#takeToken(ws, attachment)) {
      return this.#send(ws, { type: "error", error: "slow down" });
    }
    if (raw.length > MAX_FRAME) {
      return this.#send(ws, { type: "error", error: "message too large" });
    }

    let body: unknown;
    try {
      body = JSON.parse(raw)?.body;
    } catch {
      return this.#send(ws, { type: "error", error: "invalid JSON" });
    }

    if (typeof body !== "string" || !body.trim() || body.length > MAX_BODY) {
      return this.#send(ws, { type: "error", error: "invalid body" });
    }

    this.addMessage(attachment.name, body.trim());
  }

  webSocketClose(ws: WebSocket) {
    try {
      ws.close(1000, "closing");
    } catch {}
  }

  webSocketError(ws: WebSocket) {
    try {
      ws.close(1011, "error");
    } catch {}
  }
}