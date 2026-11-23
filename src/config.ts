export const ALLOWED_ORIGINS = [
  "https://herds.metalogrom.com",
  "https://herds-ads.metalogrom.com",
  "http://localhost:5173",
];

// How long an ad stays in the feed
export const AD_LIFETIME_DAYS = 7;

// Ads per room per go-live day. Every ad lives AD_LIFETIME_DAYS, so this many can overlap per day.
export const ADS_PER_DAY = 3;

// Spare feed slots for admin news
const ADMIN_NEWS_SLOTS = 3;

// Feed size: all live ads, plus room for admin posts
export const NEWS_FEED_LIMIT = ADS_PER_DAY * AD_LIFETIME_DAYS + ADMIN_NEWS_SLOTS;