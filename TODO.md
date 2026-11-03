# todo

- Should i store messages?

- Frontend escaping. The server broadcasts raw text, so your client must render messages as plain text, never as HTML. This is the one that can bite you.

- Impersonation. With no auth, a username only belongs to someone while they’re connected. Anyone can take alice once she leaves. That’s inherent to the no-login design.

- Moderation. There are no bans, no profanity filter and no way to kick a user. The per-IP caps are the only brake on a determined spammer.

- Dead connections. There’s no ping or heartbeat, so a client that drops silently keeps its slot until the connection times out. Cloudflare’s ctx.setWebSocketAutoResponse can handle that cheaply.

- Deployment. Set ADMIN_KEY with wrangler secret put before you deploy, and replace the placeholder origin in config.ts with your real frontend.