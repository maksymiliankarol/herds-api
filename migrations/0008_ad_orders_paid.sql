DROP INDEX idx_news_queue_session;
ALTER TABLE news_queue DROP COLUMN stripe_session_id;

ALTER TABLE ad_orders ADD COLUMN paid_at TEXT;
CREATE UNIQUE INDEX idx_ad_orders_session ON ad_orders(stripe_session_id);