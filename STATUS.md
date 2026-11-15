# Gauge — status

Updated: 2026-11-15 · Site: https://gauge.gershon.ai · Repo: gershonconsulting/gauge (main)

## What it is
"You are using X% of your Sales Navigator capacity!" Click the extension, get a grade. Independent app (not Radar).
First Gershon app to go through Chrome Web Store review.

## State
- ✅ Site: landing, LinkedIn sign-in (`openid profile email` only), `/report`, `/api/grade`, privacy/terms/support
- ✅ Extension v0.2.0 (`extension/`, MV3): consent screen (v2) → "Grade me" → opens 8 own-LinkedIn pages one at a time in a background tab, reads figures, closes tab → opens `/report#d=…`. Permissions: `scripting`, `storage`, host `www.linkedin.com`; `site-flag.js` content script on gauge.gershon.ai only (sets the installed version). Build: `node tools/build-extension.mjs` → `dist/` + `site/downloads/` + `site/extension-latest.json`.
- ✅ Capacity model in `site/score.js` (8 levers incl. **Groups joined** = groups ÷ 100, fill/work/overall, grade, top-3 moves). Reproduces the prototype (66/94/29/C+) and the reading with groups (62/81/29/C).
- ❌ Moves for that reading come out groups +5, lists +5, find +3 → 75 (groups target 70 like the other fill levers). Owner to decide whether groups should be a suggested move.
- ✅ Signed-in app `/app`: sidebar menu, Dashboard, History, Compare, Invite (`?ref=` link, badges 1/5/10/25), Share, Extension (installed/outdated/missing, zip download), Settings (show-name opt-in default OFF, 2-step Delete my data, sign out), Legal links everywhere.
- ✅ API: `/api/grade` (+history cap 100, 20 saves/day, server-checked grade), `/api/history`, `/api/settings`, `/api/invite`, `/api/compare`, `/api/delete-me`. Without KV every page says saving is off; sign-in still works.
- ✅ Tests: `npm test` on Node 22 (parsers incl. fixtures shaped like the live pages, score, game rules, app API with fake KV, worker, manifest, release, legal links)
- ✅ Store pack: `store/SUBMISSION.md`, package `dist/gauge-extension-0.2.0.zip`, assets in `store/assets/`
- ✅ Readers checked against Olivier's live pages (2026-11-14 22:15): SSI, sent invitations, dashboard, content analytics, lead/account lists, Sales Nav settings (InMail). Fixed 6 mismatches (SSI total, "People 484", impressions, list table, saved totals, InMail). Invitations scroll inside `<main>`.
- ❌ Not yet run as an installed extension end to end (needs install in Chrome; the /sales/ssi page froze the tab once — reader now times out instead of hanging)
- ❌ Saved accounts total not shown on the account-lists page; that lever may show "not read"
- ❌ Not deployed: gauge.gershon.ai not live (no Pages project / DNS). Store review needs `/privacy` live.
- ❌ Secret `LINKEDIN_CLIENT_SECRET` not set in Cloudflare. Optional KV namespace bound as `GAUGE_KV` to save scores (without it the report works, scores are not saved).
- ❌ KV `GAUGE_KV` not bound yet → history/compare/invite/settings show "saving is not switched on".
- ❌ Scores are self-reported: a signed-in user can POST any valid score (rate-limited 20/day). Leaderboards trust it. Global stats are approximate under concurrent writes (KV has no transactions).
- ❌ Rewards for inviters undecided (UI says only "Rewards for top inviters are coming"). Level names/thresholds (Starter <40, Builder, Operator 55, Pro 70, Master 85) and the 20-user percentile gate need the owner's OK.
- ❌ Chrome Web Store URL empty in `site/extension-latest.json` (`storeUrl`) → app offers the zip + Load unpacked steps until set.
- ❌ Groups reader not yet checked end-to-end on a live account in the extension (parser checked against the page text given).
- ❌ Remove "Share on LinkedIn" (w_member_social) product from the LinkedIn app before review
- ❌ Developer account steps (USD 5 fee, 2-step, trader declaration) and business postal address
- ❌ Store submission itself
- ❌ Not measurable yet: invitation acceptance rate (needs two readings), message reply rate
- ❌ Model targets/limits are Claude's proposal (fill target 70%, InMail 50/month, invites 100/week, saved limits 10,000)

## How the data flows
Extension reads → figures go in the URL fragment to `/report` (never sent to a server) → grade computed in the page → if signed in, only scores are POSTed to `/api/grade` → KV (24-month expiry): `member:`, `latest:`, `hist:` (≤100), `invites:`, `ref:<code>`, `rate:`, `stats:global` (users + 5-pt histogram). Keys documented at the top of the storage section in `site/_worker.js`.

## LinkedIn app
Client ID `86rofazxdl07cq` (public). Redirect: `https://gauge.gershon.ai/api/auth/linkedin/callback`.

## Deploy route
Cloudflare Pages, deploy root = `site/` (`_worker.js` advanced mode). Project `gauge-gershon-ai`. Then: secret (Production), optional KV `GAUGE_KV`, redeploy, custom domain `gauge.gershon.ai`, check `/api/health`.
Whenever `extension/` changes: bump `version` in the manifest, run `node tools/build-extension.mjs` (a test fails if the site's latest.json and the manifest differ).
