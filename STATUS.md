# Gauge — status

Updated: 2026-11-14 · Site: https://gauge.gershon.ai · Repo: gershonconsulting/gauge (main)

## What it is
"You are using X% of your Sales Navigator capacity!" Click the extension, get a grade. Independent app (not Radar).
First Gershon app to go through Chrome Web Store review.

## State
- ✅ Site: landing, LinkedIn sign-in (`openid profile email` only), `/report`, `/api/grade`, privacy/terms/support
- ✅ Extension v0.1.1 (`extension/`, MV3): consent screen → "Grade me" → opens 7 own-LinkedIn pages one at a time in a background tab, reads figures, closes tab → opens `/report#d=…`. Permissions: `scripting`, `storage`, host `www.linkedin.com` only. Loads cleanly in Chrome.
- ✅ Capacity model in `site/score.js` (7 levers, fill/work/overall, grade, top-3 moves). Reproduces the prototype (66% / 94% / 29% / C+).
- ✅ Tests: `npm test` — 31 passing (parsers incl. fixtures shaped like the live pages, score, worker, manifest compliance, privacy pages)
- ✅ Store pack: `store/SUBMISSION.md`, package `dist/gauge-extension-0.1.1.zip`, assets in `store/assets/`
- ✅ Readers checked against Olivier's live pages (2026-11-14 22:15): SSI, sent invitations, dashboard, content analytics, lead/account lists, Sales Nav settings (InMail). Fixed 6 mismatches (SSI total, "People 484", impressions, list table, saved totals, InMail). Invitations scroll inside `<main>`.
- ❌ Not yet run as an installed extension end to end (needs install in Chrome; the /sales/ssi page froze the tab once — reader now times out instead of hanging)
- ❌ Saved accounts total not shown on the account-lists page; that lever may show "not read"
- ❌ Not deployed: gauge.gershon.ai not live (no Pages project / DNS). Store review needs `/privacy` live.
- ❌ Secret `LINKEDIN_CLIENT_SECRET` not set in Cloudflare. Optional KV namespace bound as `GAUGE_KV` to save scores (without it the report works, scores are not saved).
- ❌ Remove "Share on LinkedIn" (w_member_social) product from the LinkedIn app before review
- ❌ Developer account steps (USD 5 fee, 2-step, trader declaration) and business postal address
- ❌ Store submission itself
- ❌ Not measurable yet: invitation acceptance rate (needs two readings), message reply rate
- ❌ Model targets/limits are Claude's proposal (fill target 70%, InMail 50/month, invites 100/week, saved limits 10,000)

## How the data flows
Extension reads → figures go in the URL fragment to `/report` (never sent to a server) → grade computed in the page → if signed in, only scores are POSTed to `/api/grade` → KV (`latest:<memberId>`, 24-month expiry).

## LinkedIn app
Client ID `86rofazxdl07cq` (public). Redirect: `https://gauge.gershon.ai/api/auth/linkedin/callback`.

## Deploy route
Cloudflare Pages, deploy root = `site/` (`_worker.js` advanced mode). Project `gauge-gershon-ai`. Then: secret (Production), optional KV `GAUGE_KV`, redeploy, custom domain `gauge.gershon.ai`, check `/api/health`.
Rebuild the extension zip from `extension/` whenever it changes (bump `version` in manifest).
