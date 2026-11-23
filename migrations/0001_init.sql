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

CREATE TABLE news (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  content    TEXT NOT NULL,
  room_id    INTEGER NOT NULL REFERENCES rooms(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE bans (
  ip         TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL
);

CREATE TABLE news_queue (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  content    TEXT NOT NULL,
  room_id    INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  publish_at TEXT NOT NULL
);

CREATE TABLE ad_orders (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  content           TEXT NOT NULL,
  room_id           INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  publish_at        TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  stripe_session_id TEXT,
  paid_at           TEXT
);

CREATE INDEX idx_rooms_city_id ON rooms(city_id);
CREATE INDEX idx_news_room_id ON news(room_id);
CREATE UNIQUE INDEX idx_cities_title_country ON cities(title COLLATE NOCASE, country_code);
CREATE UNIQUE INDEX idx_rooms_city_title ON rooms(city_id, title COLLATE NOCASE);
CREATE INDEX idx_news_queue_publish_at ON news_queue(publish_at);
CREATE UNIQUE INDEX idx_ad_orders_session ON ad_orders(stripe_session_id);