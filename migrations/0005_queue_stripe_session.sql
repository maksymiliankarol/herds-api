ALTER TABLE news_queue ADD COLUMN stripe_session_id TEXT;
CREATE UNIQUE INDEX idx_news_queue_session ON news_queue(stripe_session_id);