import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";

// Stable ids that clients turn into text. Never rename or reuse one: apps in the
// wild depend on them. Adding new ones is always safe.
export type ErrorCode =
  // public: web and native clients may show these
  | "rate_limited"
  | "city_not_found"
  | "room_not_found"
  | "not_found"
  | "internal"
  | "invalid_input"
  | "forbidden_origin"
  | "upgrade_required"
  // admin only: used from curl, no screen shows them
  | "unauthorized"
  | "admin_not_configured"
  | "invalid_slug"
  | "invalid_name"
  | "invalid_code"
  | "invalid_country"
  | "invalid_id"
  | "invalid_news_title"
  | "invalid_news_body"
  | "title_required"
  | "country_not_found"
  | "parent_room_not_found"
  | "news_not_found"
  | "city_exists"
  | "country_exists"
  | "room_exists"
  | "country_has_cities";

export type ErrorBody = { code: ErrorCode };

export const errorBody = (code: ErrorCode): ErrorBody => ({ code });

// For throwing from helpers; onError in index.ts turns it into { code }.
// Nothing throws it yet: routes return errorBody() directly.
export class ApiException extends HTTPException {
  code: ErrorCode;

  constructor(status: ContentfulStatusCode, code: ErrorCode) {
    super(status, { message: code });
    this.code = code;
  }
}