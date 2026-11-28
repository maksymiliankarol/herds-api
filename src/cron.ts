// Unpaid ads only; paid ones are kept as the Stripe record
export async function runCron(env: CloudflareBindings) {
  await env.DB
    .prepare("DELETE FROM ads WHERE paid_at IS NULL AND created_at < datetime('now', '-2 hours')")
    .run();
}