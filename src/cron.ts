import { AD_LIFETIME_DAYS } from "./config";

const toSql = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");

// Moves due items from news_queue to news in one transaction
async function publishDueNews(env: CloudflareBindings) {
  // One "now" for both statements, so a row can't become due between them and get deleted unpublished
  const now = toSql(new Date());

  await env.DB.batch([
    env.DB
      .prepare(
        `INSERT INTO news (content, room_id, created_at)
        SELECT content, room_id, publish_at FROM news_queue
        WHERE publish_at <= ? ORDER BY publish_at, id`,
      )
      .bind(now),
    env.DB.prepare("DELETE FROM news_queue WHERE publish_at <= ?").bind(now),
  ]);
}

async function cleanup(env: CloudflareBindings) {
  await env.DB.batch([
    // Unpaid orders only; paid ones are kept as the Stripe record
    env.DB.prepare("DELETE FROM ad_orders WHERE paid_at IS NULL AND created_at < datetime('now', '-2 hours')"),
    env.DB
      .prepare("DELETE FROM news WHERE created_at <= datetime('now', ?)")
      .bind(`-${AD_LIFETIME_DAYS} days`),
  ]);
}

export async function runCron(env: CloudflareBindings) {
  await publishDueNews(env);
  await cleanup(env);
}