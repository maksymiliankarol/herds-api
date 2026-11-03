import * as v from "valibot"

const RESERVED_USERNAMES = [
  "admin", "administrator", "mod", "moderator", "system", 
  "support", "staff", "root", "herds", "server", "null", 
  "undefined"
];

const Id = v.pipe(v.string(), v.regex(/^\d+$/, "Invalid id"), v.transform(Number));

export const CitySchema = v.object({
  city: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(100)),
  city_label: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(100)),
  country_code: v.pipe(v.string(), v.trim(), v.toUpperCase(), v.regex(/^[A-Z]{2}$/, "Invalid country code")),
});

export const RoomSchema = v.object({
  title: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(100)),
  city_id: v.pipe(v.number(), v.integer(), v.minValue(1)),
});

export const UsernameSchema = v.object({
  username: v.pipe(
    v.string(),
    v.regex(/^[A-Za-z0-9_]{3,20}$/, "3-20 letters, numbers or _"),
    v.check((u) => !RESERVED_USERNAMES.includes(u.toLowerCase()), "Username is reserved"),
  ),
});

export const MessageSchema = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxBytes(2000));
export const IdParamSchema = v.object({ id: Id });
export const RoomsQuerySchema = v.object({ city_id: Id });
export const CitySearchSchema = v.object({
  q: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(100)),
});