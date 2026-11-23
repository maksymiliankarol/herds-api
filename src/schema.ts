import * as v from "valibot";

const RESERVED_USERNAMES = [
  "admin", "administrator", "mod", "moderator", "system",
  "support", "staff", "root", "herds", "server", "null",
  "undefined",
];

const Text = (max: number, min = 1) => 
  v.pipe(v.string(), v.trim(), v.minLength(min), v.maxLength(max));
const PositiveInt = v.pipe(v.number(), v.integer(), v.minValue(1));
const Id = v.pipe(v.string(), v.regex(/^[1-9][0-9]{0,9}$/, "Invalid id"), v.transform(Number));

export const CitySchema = v.object({
  title: Text(100),
  search: v.pipe(Text(100), v.toLowerCase()),
  country_code: v.pipe(v.string(), v.trim(), v.toUpperCase(), v.regex(/^[A-Z]{2}$/, "Invalid country code")),
});

export const RoomSchema = v.object({ title: Text(100), city_id: PositiveInt });

export const NewsSchema = v.object({
  content: Text(500, 20),
  room_id: PositiveInt,
});

// Accepts an ISO timestamp with a zone (e.g. 2026-11-20T09:00:00Z or ...+01:00)
// and stores it as UTC "YYYY-MM-DD HH:MM:SS", the same format as CURRENT_TIMESTAMP
const PublishAt = v.pipe(
  v.string(),
  v.isoTimestamp(),
  v.transform((s) => new Date(s)),
  v.check((d) => !Number.isNaN(d.getTime()), "Invalid date"),
  v.check((d) => d.getTime() >= Date.now(), "publish_at must be in the future"),
  v.check((d) => d.getTime() <= Date.now() + 90 * 24 * 60 * 60 * 1000, "publish_at must be within 90 days"),
  v.transform((d) => d.toISOString().slice(0, 19).replace("T", " ")),
);

export const NewsQueueSchema = v.object({ ...NewsSchema.entries, publish_at: PublishAt });

export const UsernameSchema = v.object({
  username: v.pipe(
    v.string(),
    v.regex(/^[A-Za-z0-9_]{3,20}$/, "3-20 letters, numbers or _"),
    v.check((u) => !RESERVED_USERNAMES.includes(u.toLowerCase()), "Username is reserved"),
  ),
});

export const KickSchema = v.pipe(
  v.object({
    username: v.optional(v.string()),
    ip: v.optional(v.string()),
    ban_hours: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(720))),
  }),
  v.check((k) => Boolean(k.username || k.ip), "username or ip required"),
);

export const MessageSchema = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxBytes(2000));
export const IdParamSchema = v.object({ id: Id });
export const RoomsQuerySchema = v.object({ city_id: Id });
export const NewsQuerySchema = v.object({ room_id: Id });
export const CitySearchSchema = v.object({ q: Text(100) });
