DROP TABLE IF EXISTS news;
DROP TABLE IF EXISTS rooms;
DROP TABLE IF EXISTS cities;
DROP TABLE IF EXISTS countries;

CREATE TABLE countries (
  code       TEXT PRIMARY KEY,                 -- ISO 3166-1 alpha-2, lowercase: 'pl'
  name       TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE cities (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  slug       TEXT NOT NULL UNIQUE,             -- used in URLs: /city/krakow
  name       TEXT NOT NULL,                    -- display name
  country    TEXT NOT NULL REFERENCES countries (code),
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX idx_cities_country ON cities (country);

CREATE TABLE rooms (
  id         INTEGER PRIMARY KEY AUTOINCREMENT, -- the Durable Object name is derived from this
  city_id    INTEGER NOT NULL REFERENCES cities (id) ON DELETE CASCADE,
  slug       TEXT NOT NULL,                     -- used in URLs: /city/krakow/food
  title      TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  UNIQUE (city_id, slug)
);

CREATE TABLE news (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id    INTEGER NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- newest news for a room, which is the only way the client reads them
CREATE INDEX idx_news_room ON news (room_id, created_at DESC);

-- seed so the cities page has something to show
INSERT INTO countries (code, name) VALUES ('pl', 'Poland');
INSERT INTO cities (slug, name, country) VALUES
  ('krakow', 'Krakow', 'pl'),
  ('warsaw', 'Warsaw', 'pl');