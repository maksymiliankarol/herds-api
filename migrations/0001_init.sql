CREATE TABLE cities (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  search       TEXT NOT NULL,   -- matched against
  title        TEXT NOT NULL,   -- displayed
  country_code TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (search, country_code)
);

CREATE TABLE rooms (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  city_id    INTEGER NOT NULL REFERENCES cities(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE bans (
  ip         TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL
);

-- paid_at IS NULL: waiting for payment. Paid ads are the live ads and the Stripe record.
CREATE TABLE ads (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  content           TEXT NOT NULL,
  url               TEXT NOT NULL,
  url_text          TEXT NOT NULL,
  room_id           INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  publish_at        TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  stripe_session_id TEXT,
  paid_at           TEXT
);

CREATE INDEX idx_rooms_city_id ON rooms(city_id);
CREATE UNIQUE INDEX idx_cities_title_country ON cities(title COLLATE NOCASE, country_code);
CREATE UNIQUE INDEX idx_rooms_city_title ON rooms(city_id, title COLLATE NOCASE);
CREATE UNIQUE INDEX idx_ads_session ON ads(stripe_session_id);
-- One ad per room per day (also serves the lookups by room)
CREATE UNIQUE INDEX idx_ads_slot ON ads(room_id, publish_at);