CREATE TABLE news_queue (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  content    TEXT NOT NULL,
  room_id    INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  publish_at TEXT NOT NULL
);

CREATE INDEX idx_news_queue_publish_at ON news_queue(publish_at);