CREATE TABLE cities (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  city         TEXT NOT NULL,
  city_label   TEXT NOT NULL,
  country_code TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (city, country_code)
);

CREATE TABLE rooms (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  city_id    INTEGER NOT NULL REFERENCES cities(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE news (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  content    TEXT NOT NULL,
  room_id    INTEGER NOT NULL REFERENCES rooms(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_rooms_city_id ON rooms(city_id);
CREATE INDEX idx_news_room_id ON news(room_id);