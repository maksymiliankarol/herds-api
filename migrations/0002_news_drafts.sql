CREATE TABLE IF NOT EXISTS news_drafts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id    INTEGER NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  sources    TEXT NOT NULL,  -- JSON array of the URLs the draft is based on
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);