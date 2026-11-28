# herds-api

Cloudflare Worker (Hono, D1, Durable Objects) for Herds: cities, rooms, live chat, news and paid ads.

Admin tasks (cities, rooms, news, kicking users) are done with `herds-admin`.

## Setup

```bash
pnpm install
```

`.dev.vars`:

```
ADMIN_KEY=...
STRIPE_SECRET_KEY=...
STRIPE_WEBHOOK_SECRET=...
```

For production, set the same values as secrets with `wrangler secret put <NAME>`.

## Commands

```bash
pnpm dev           # run locally at http://localhost:8787
pnpm deploy        # deploy to Cloudflare
pnpm cf-typegen    # regenerate CloudflareBindings types after changing wrangler.jsonc
```

Migrations:

```bash
wrangler d1 migrations apply herds-db --local
```

```bash
wrangler d1 migrations apply herds-db --remote
```

Forward Stripe webhooks to the local server:

```bash
stripe listen --forward-to localhost:8787/stripe/webhook
```

## Rooms tree

A room name like `food` can have children, e.g. `food_child`. The `_` is the separator that makes a child. The UI shows them as `Food` and `Child`.