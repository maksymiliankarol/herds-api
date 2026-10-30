import { DurableObject } from "cloudflare:workers";
import { rejectUpgrade } from "./lib/ws";

export type Message = { id: number; author: string; body: string; created_at: number };

type ErrorCode =
  | "slow_down"
  | "too_many_messages"
  | "message_too_large"
  | "invalid_json"
  | "invalid_body";

type ServerEvent =
  | { type: "history"; messages: Message[] }
  | { type: "message"; message: Message }
  | { type: "error"; code: ErrorCode }
  | { type: "rejected"; code: number };

// tokens/at are optional because sockets opened before the limiter existed have neither;
// ip is optional for the same reason (and because it's missing in local dev)
type Attachment = { name: string; ip?: string; tokens?: number; at?: number; strikes?: number };

type Bucket = { tokens: number; at: number };

// Refill by elapsed time, then try to take one token
function takeFrom(bucket: Bucket, burst: number, refillMs: number, now: number) {
  const tokens = Math.min(burst, bucket.tokens + Math.max(0, now - bucket.at) / refillMs);
  const allowed = tokens >= 1;
  return { allowed, bucket: { tokens: allowed ? tokens - 1 : tokens, at: now } };
}

const MAX_BODY = 2000;
const MAX_FRAME = 8192; // raw frame size in bytes, checked before parsing
const NAME = /^[\p{L}\p{N}_-]{2,20}$/u;
const encoder = new TextEncoder();

// Message rate limit per socket: bursts of 5, then 1 message per second
const BURST = 5;
const IP_BURST = 10;
const REFILL_MS = 1000;
const IP_REFILL_MS = 500;
const MAX_CONNECTIONS = 200;
const MAX_PER_IP = 3; 
const MAX_STRIKES = 10;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // messages older than this are deleted

const SWEEP_MS = 60_000;     // alarm interval while the room has sockets
const DEAD_MS = 5 * 60_000;  // no ping and no message for this long: close
const KEEP_MESSAGES = 100;   // stored per room; history/messages endpoints only serve 50

// Custom close codes (4000-4999 are reserved for applications)
const CLOSE_INVALID_NAME = 4400;
const CLOSE_NAME_TAKEN = 4409;
const CLOSE_ROOM_FULL = 4429;
const CLOSE_IP_LIMIT = 4430;
const CLOSE_IDLE = 4408;
const CLOSE_RATE_LIMITED = 4431;


export class Room extends DurableObject<CloudflareBindings> {
  #ipBuckets = new Map<string, Bucket>(); // lost on hibernation, which is fine (see above)
  constructor(ctx: DurableObjectState, env: CloudflareBindings) {
    super(ctx, env);
    this.#initSchema();
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  // --- Private helpers --- 

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

  #connectionsFrom(ip: string): number {
    return this.ctx.getWebSockets().filter((ws) => {
      const attachment = ws.deserializeAttachment() as Attachment | null;
      return attachment?.ip === ip;
    }).length;
  }

  // Socket bucket (kept in the attachment, survives hibernation) plus IP bucket (in memory).
  // Both must pass. strikes counts consecutive rejections and resets on an allowed message.
  #takeToken(ws: WebSocket, a: Attachment): { allowed: boolean; strikes: number } {
    const now = Date.now();

    const socket = takeFrom({ tokens: a.tokens ?? BURST, at: a.at ?? now }, BURST, REFILL_MS, now);
    let allowed = socket.allowed;

    // only check the IP once the socket passed, and skip it when the IP is unknown (local dev)
    if (allowed && a.ip) {
      const ip = takeFrom(
        this.#ipBuckets.get(a.ip) ?? { tokens: IP_BURST, at: now },
        IP_BURST,
        IP_REFILL_MS,
        now,
      );
      this.#ipBuckets.set(a.ip, ip.bucket);
      allowed = ip.allowed;
    }

    const strikes = allowed ? 0 : (a.strikes ?? 0) + 1;
    ws.serializeAttachment({
      ...a,
      tokens: socket.bucket.tokens,
      at: now,
      strikes,
    } satisfies Attachment);

    return { allowed, strikes };
  }

  async #ensureAlarm() {
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + SWEEP_MS);
    }
  }

  #prune() {
    // ids only grow, so "newest id minus N" keeps the last N rows; an empty table deletes nothing
    this.ctx.storage.sql.exec(
      "DELETE FROM messages WHERE id <= (SELECT MAX(id) - ? FROM messages)",
      KEEP_MESSAGES,
    );
    this.ctx.storage.sql.exec("DELETE FROM messages WHERE created_at < ?", Date.now() - MAX_AGE_MS);
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

  listMessages(limit = 100): Message[] {
    this.#prune();
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

  // --- Runtime entry points ---

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    if (this.ctx.getWebSockets().length >= MAX_CONNECTIONS) {
      return rejectUpgrade(CLOSE_ROOM_FULL);
    }

    const ip = request.headers.get("CF-Connecting-IP"); // absent in local dev: no cap applied

    const name = new URL(request.url).searchParams.get("name")?.trim() ?? "";
    if (!NAME.test(name)) return rejectUpgrade(CLOSE_INVALID_NAME);
    if (this.#nameTaken(name)) return rejectUpgrade(CLOSE_NAME_TAKEN);
    if (ip && this.#connectionsFrom(ip) >= MAX_PER_IP) {
      return rejectUpgrade(CLOSE_IP_LIMIT);
    }

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ name, ip: ip ?? undefined, tokens: BURST, at: Date.now() } satisfies Attachment);
    this.#send(server, { type: "history", messages: this.listMessages() });
    await this.#ensureAlarm();

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== "string") return;

    const attachment = ws.deserializeAttachment() as Attachment | null;
    if (!attachment) return;

    // cheapest checks first, so a flood costs as little as possible
    const { allowed, strikes } = this.#takeToken(ws, attachment);
    if (!allowed) {
      if (strikes >= MAX_STRIKES) {
        // frames already in flight can still arrive after the close, so never let this throw
        try {
          this.#send(ws, { type: "error", code: "too_many_messages" }); // was error: "too many messages"
          ws.close(CLOSE_RATE_LIMITED, "rate limited");
        } catch {}
        return;
      }
      return this.#send(ws, { type: "error", code: "slow_down" });
    }

    // bytes are never fewer than characters, so the cheap length check goes first
    if (raw.length > MAX_FRAME || encoder.encode(raw).byteLength > MAX_FRAME) {
      return this.#send(ws, { type: "error", code: "message_too_large" });
    }
    
    let body: unknown;
    try {
      body = JSON.parse(raw)?.body;
    } catch {
      return this.#send(ws, { type: "error", code: "invalid_json" });
    }

    if (typeof body !== "string" || !body.trim() || body.length > MAX_BODY) {
      return this.#send(ws, { type: "error", code: "invalid_body" });
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

  async alarm() {
    const now = Date.now();
    let alive = 0;

    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      const ping = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0;
      const last = Math.max(a?.at ?? 0, ping);

      // last === 0: socket from before the limiter existed, nothing to judge it by
      if (last && now - last > DEAD_MS) {
        try {
          ws.close(CLOSE_IDLE, "idle timeout");
        } catch {}
      } else {
        alive++;
      }
    }

    // drop IP buckets that have fully refilled: a missing bucket starts full anyway
    for (const [ip, bucket] of this.#ipBuckets) {
      if (now - bucket.at >= IP_BURST * IP_REFILL_MS) this.#ipBuckets.delete(ip);
    }

    this.#prune();

    // no sockets left means no new messages, so the last sweep was the final one
    if (alive > 0) await this.ctx.storage.setAlarm(now + SWEEP_MS);
  }
}