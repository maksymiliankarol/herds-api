import * as v from "valibot";

const RESERVED_USERNAMES = [
  "admin", "administrator", "mod", "moderator", "system",
  "support", "staff", "root", "herds", "server", "null",
  "undefined",
];

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------- Building blocks ----------

const Text = (max: number, min = 1) =>
  v.pipe(v.string(), v.trim(), v.minLength(min), v.maxLength(max));
const PositiveInt = v.pipe(v.number(), v.integer(), v.minValue(1));
const Id = v.pipe(v.string(), v.regex(/^[1-9][0-9]{0,9}$/, "Invalid id"), v.transform(Number));

// new URL() lowercases the host. Needs a dot-separated name whose last label starts with a letter,
// so "sss.", "localhost" and IP addresses fail.
const HOSTNAME = /^([a-z0-9-]+\.)+[a-z][a-z0-9-]*$/;

function isValidAdUrl(s: string) {
  try {
    const u = new URL(s);
    return u.protocol === "https:" && HOSTNAME.test(u.hostname) && !u.username && !u.password;
  } catch {
    return false;
  }
}

const Url = v.pipe(v.string(), v.trim(), v.maxLength(2000), v.check(isValidAdUrl, "Enter a valid https:// link"));

// Accepts an ISO timestamp with a zone (e.g. 2026-11-20T00:00:00Z) and stores it as UTC
// "YYYY-MM-DD HH:MM:SS", the same format as CURRENT_TIMESTAMP.
// Ads go live at midnight UTC: one day is one slot.
const PublishAt = v.pipe(
  v.string(),
  v.isoTimestamp(),
  v.transform((s) => new Date(s)),
  v.check((d) => !Number.isNaN(d.getTime()), "Invalid date"),
  v.check((d) => d.getTime() % DAY_MS === 0, "publish_at must be midnight UTC"),
  v.check((d) => d.getTime() >= Date.now(), "publish_at must be in the future"),
  v.check((d) => d.getTime() <= Date.now() + 90 * DAY_MS, "publish_at must be within 90 days"),
  v.transform((d) => d.toISOString().slice(0, 19).replace("T", " ")),
);

// ---------- Request bodies ----------

export const CitySchema = v.object({
  title: Text(100),
  search: v.pipe(Text(100), v.toLowerCase()),
  country_code: v.pipe(v.string(), v.trim(), v.toUpperCase(), v.regex(/^[A-Z]{2}$/, "Invalid country code")),
});

export const RoomSchema = v.object({ title: Text(100), city_id: PositiveInt });

export const NewAdSchema = v.object({
  content: Text(200, 10),
  url: Url,
  url_text: Text(30),
  room_id: PositiveInt,
  publish_at: PublishAt,
});

export const KickSchema = v.pipe(
  v.object({
    username: v.optional(v.string()),
    ip: v.optional(v.string()),
    ban_hours: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(720))),
  }),
  v.check((k) => Boolean(k.username || k.ip), "username or ip required"),
);

// ---------- Chat ----------

export const UsernameSchema = v.object({
  username: v.pipe(
    v.string(),
    v.regex(/^[A-Za-z0-9_]{3,20}$/, "3-20 letters, numbers or _"),
    v.check((u) => !RESERVED_USERNAMES.includes(u.toLowerCase()), "Username is reserved"),
  ),
});

export const MessageSchema = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxBytes(2000));

// ---------- Params and queries ----------

export const IdParamSchema = v.object({ id: Id });
export const RoomsQuerySchema = v.object({ city_id: Id });
export const CitySearchSchema = v.object({ q: Text(100) });
export const AdsQuerySchema = v.object({ room_id: Id });