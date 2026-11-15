# Gauge

gauge.gershon.ai — "How good are you with Sales Navigator?"

- `site/` — Cloudflare Pages deploy root. `_worker.js` handles LinkedIn sign-in and the session cookie; everything else is static.
- `test/` — `npm test`
- `STATUS.md` — current state and open items. Read it first.

Secrets live only in Cloudflare (`LINKEDIN_CLIENT_SECRET`, `SESSION_SECRET`). Never commit them.
