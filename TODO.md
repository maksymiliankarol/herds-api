# todo

- We should have room label and room name just like cities, if we ever use it in param.

- Should i store messages?

- Dead connections. There’s no ping or heartbeat, so a client that drops silently keeps its slot until the connection times out. Cloudflare’s ctx.setWebSocketAutoResponse can handle that cheaply.

- Deployment. Set ADMIN_KEY with wrangler secret put before you deploy, and replace the placeholder origin in config.ts with your real frontend.