---
title: Cloudflare Workers
department: engineering
stacks: [cloudflare-workers]
paths:
  - "src/**/*.{ts,js}"
  - "worker/**/*.{ts,js}"
  - "workers/**/*.{ts,js}"
  - "functions/**/*.{ts,js}"
  - "wrangler.{toml,json,jsonc}"
---
- Check the installed Wrangler version and the project's `compatibility_date`; read the docs for that date and keep it recent.
- Declare every binding (KV, D1, R2, Durable Objects, Queues) in the Wrangler config; rerun `wrangler types` after changes.
- Secrets go in with `wrangler secret put` and a gitignored local dev vars file; never in `vars`, code or logs.
- Use web standard APIs (`fetch`, `Request`, `Response`, Web Crypto); Node APIs only with `nodejs_compat` and checked support.
- Never keep request data in module scope: one isolate serves many requests and can be evicted at any time.
- Hand work that may finish after the response (logging, analytics, cache writes) to `ctx.waitUntil`; no floating promises.
- Stay inside CPU, memory and subrequest limits: stream large bodies, don't buffer whole files, batch outbound calls.
- D1: prepared statements with `.bind()`, never string-built SQL; `batch()` related writes; schema changes as D1 migrations.
- KV is eventually consistent: never use it for counters, locks or read-after-write; use a Durable Object or D1 for those.
- One Durable Object per unit of coordination (a room, a document, a user); never funnel all traffic through one global object.
- Durable Object state lives in its storage, not only in memory; use alarms for scheduled work and keep handlers idempotent.
- Validate every request (method, params, body) and return JSON errors with correct status codes; set CORS explicitly.
- Cache public GET responses with the Cache API or cache headers; never cache responses that carry user data.
- Queue consumers and Cron Triggers are idempotent and safe to retry; failures go to a dead-letter queue or a watched log.
- Test in the Workers runtime with the Workers Vitest integration and run locally with `wrangler dev`, not in plain Node.
- Log structured JSON with a request id; turn on Workers Logs or use `wrangler tail` when debugging.
- Deploy only through the project's deploy script and only when asked; check a preview URL or version first.
