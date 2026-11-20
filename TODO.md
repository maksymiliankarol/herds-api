# todo

- Dead connections. There’s no ping or heartbeat, so a client that drops silently keeps its slot until the connection times out. Cloudflare’s ctx.setWebSocketAutoResponse can handle that cheaply.

- Cron job for deleting old news. Each should have 7 days lifetime.