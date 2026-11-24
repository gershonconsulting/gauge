# Gauge — status

Updated: 2026-11-24 · Site: https://gauge.gershon.ai · Repo: gershonconsulting/gauge (main)

## What it is
"You are using X% of your Sales Navigator capacity!" Click the extension, get a grade. Independent app (not Radar).
First Gershon app to go through Chrome Web Store review.

## State
- Version 2026-11-19: main = 0.4.0 (PR #3 merged: extension 0.4.0, APP_VERSION 0.4.0 in site/_worker.js). LIVE gauge.gershon.ai/api/health = 0.3.0. Direct-upload Pages project, not deployed. Deploy = Pages upload of site/ once the Chrome Web Store approves extension 0.4.0 (still in review).
- ✅ Site: landing, LinkedIn sign-in (`openid profile email` only), `/report`, `/api/grade`, privacy/terms/support
- ✅ Extension v0.3.0 (`extension/`, MV3): consent screen (v2) → "Grade me" → opens 8 own-LinkedIn pages one at a time in ONE minimized window (fallback: background tab), reads figures, closes the window → opens `/report#d=…`. Permissions: `scripting`, `storage`, host `www.linkedin.com`; `site-flag.js` content script on gauge.gershon.ai only (sets the installed version). Build: `node tools/build-extension.mjs` → `dist/` + `site/downloads/` + `site/extension-latest.json`.
- ✅ Capacity model in `site/score.js` (8 levers incl. **Groups joined** = groups ÷ 100, fill/work/overall, grade, top-3 moves). Reproduces the prototype (66/94/29/C+) and the reading with groups (62/81/29/C).
- ❌ Moves for that reading come out groups +5, lists +5, find +3 → 75 (groups target 70 like the other fill levers). Owner to decide whether groups should be a suggested move.
- ✅ Signed-in app `/app`: sidebar menu, Dashboard, History, Compare, Invite (`?ref=` link, badges 1/5/10/25), Share, Extension (installed/outdated/missing, zip download), Settings (show-name opt-in default OFF, 2-step Delete my data, sign out), Legal links everywhere.
- ✅ API: `/api/grade` (+history cap 100, 20 saves/day, server-checked grade), `/api/history`, `/api/settings`, `/api/invite`, `/api/compare`, `/api/delete-me`. Without KV every page says saving is off; sign-in still works.
- ✅ Tests: `npm test` on Node 22 (parsers incl. fixtures shaped like the live pages, score, game rules, app API with fake KV, worker, manifest, release, legal links)
- ✅ Store pack: `store/SUBMISSION.md`, package `dist/gauge-extension-0.3.0.zip`, assets in `store/assets/`
- ✅ Readers checked against Olivier's live pages (2026-11-14 22:15): SSI, sent invitations, dashboard, content analytics, lead/account lists, Sales Nav settings (InMail). Fixed 6 mismatches (SSI total, "People 484", impressions, list table, saved totals, InMail). Invitations scroll inside `<main>`.
- ❌ Not yet run as an installed extension end to end (needs install in Chrome; the /sales/ssi page froze the tab once — reader now times out instead of hanging)
- ❌ Saved accounts total not shown on the account-lists page; that lever may show "not read"
- ✅ Deployed 2026-11-15: Pages project `gauge-gershon-ai` (direct upload, no Git link), custom domain gauge.gershon.ai active with SSL; `/`, `/app`, `/privacy`, `/terms`, `/support`, `/report`, extension zip all 200. `_redirects` removed (it looped on Pages). Redeploy = Pages → Create deployment → upload `site/` as a zip (Production).
- ✅ Secret `LINKEDIN_CLIENT_SECRET` set (Production) and active since the 2026-11-16 redeploy of main a68a4a7 (17 site files, each checked against its git blob sha before upload). `/api/health` = `linkedinSecretSet: true`, `sessionKeyReady: true`; `/api/auth/linkedin/start` redirects to LinkedIn's sign-in.
- ❌ LinkedIn sign-in not yet completed end to end by a real user (start → LinkedIn → callback → `/app`).
- ❌ No auto-deploy: the Pages project is direct upload, which cannot be linked to Git afterwards. Auto-deploy on merge needs a GitHub Actions deploy workflow (Cloudflare API token as a repo secret) or a new Git-connected project.
- ✅ KV namespace `gauge-gershon-ai-store` bound as `GAUGE_KV` (Production) and live.
- ❌ Scores are self-reported: a signed-in user can POST any valid score (rate-limited 20/day). Leaderboards trust it. Global stats are approximate under concurrent writes (KV has no transactions).
- ❌ Rewards for inviters undecided (UI says only "Rewards for top inviters are coming"). Level names/thresholds (Starter <40, Builder, Operator 55, Pro 70, Master 85) and the 20-user percentile gate need the owner's OK.
- ✅ 2026-11-17: Chrome Web Store listing APPROVED and live (v0.3.0): https://chromewebstore.google.com/detail/epadkmhdddplghochdbobleclchhdbef — `storeUrl` set in `site/extension-latest.json`; app now shows "Add Gauge to Chrome".
- ❌ Groups reader not yet checked end-to-end on a live account in the extension (parser checked against the page text given).
- ❌ Remove "Share on LinkedIn" (w_member_social) product from the LinkedIn app before review
- ❌ Developer account steps (USD 5 fee, 2-step, trader declaration) and business postal address
- ✅ 2026-11-16 21:45: submitted to Chrome Web Store review (publisher olivier@gershonconsulting.com, item ID epadkmhdddplghochdbobleclchhdbef, status Pending review). On approval: set `storeUrl` in site/extension-latest.json to https://chromewebstore.google.com/detail/epadkmhdddplghochdbobleclchhdbef and redeploy.
- ❌ Official URL not set on the listing: Search Console tag in index.html (eed30af) not yet deployed/verified
- ❌ Not measurable yet: invitation acceptance rate (needs two readings), message reply rate
- ❌ Model targets/limits are Claude's proposal (fill target 70%, InMail 50/month, invites 100/week, saved limits 10,000)

- ✅ 2026-11-16: tab icon on every page (`favicon.ico`, 32px PNG, apple-touch, 192/512; made by `tools/make-site-icons.py`). Before, only `/` had an inline icon and `/favicon.ico` returned the home page HTML.
- ✅ 2026-11-16: signed-in pages show a large "Step 1 — Download the Gauge Chrome extension now" block (direct download button) whenever the extension is missing.
- ❌ Minimized-window reading not yet run end to end on a real install (LinkedIn may lazy-load less in a minimized window; fallback is the old background tab).
- Background policy: user-started runs only. Scheduled/automatic grading NOT built (Web Store would accept it with opt-in disclosure; LinkedIn terms risk is the blocker — owner's call).

- ✅ 2026-11-16 11:27: production redeployed from main 102c1c1 (Olivier's OK): tab icons, install call, privacy text "minimized window", v0.3.0 download all live.

- ✅ 2026-11-16 (eve): `/admin` (admin accounts only: olivier@attia.com (his LinkedIn email), olivier@gershonconsulting.com, oattia@gmail.com, + env `ADMIN_EMAILS`), `/api/admin/summary|member|daily`. Names/emails/scores ONLY for members who tick "Share my result with Gershon Consulting" (`member.shareWithGershon`, off by default; report page + Settings); everyone else = anonymous totals (Limited Use). Privacy policy updated (consent bullet + Resend as processor).
- ✅ Daily email: `.github/workflows/daily-report.yml` 23:00 UTC (6 PM EST) → POST `/api/admin/daily` → Resend from gauge@gershon.ai to report@gershonconsulting.com, subject "Gauge Report — <dates>", max once per 20 h. Needs Pages secret `RESEND_API_KEY` (Production).

## How the data flows
Extension reads → figures go in the URL fragment to `/report` (never sent to a server) → grade computed in the page → if signed in, only scores are POSTed to `/api/grade` → KV (24-month expiry): `member:`, `latest:`, `hist:` (≤100), `invites:`, `ref:<code>`, `rate:`, `stats:global` (users + 5-pt histogram). Keys documented at the top of the storage section in `site/_worker.js`.

## LinkedIn app
Client ID `86rofazxdl07cq` (public). Redirect: `https://gauge.gershon.ai/api/auth/linkedin/callback`.

## Deploy route
Cloudflare Pages, deploy root = `site/` (`_worker.js` advanced mode). Project `gauge-gershon-ai`. Then: secret (Production), optional KV `GAUGE_KV`, redeploy, custom domain `gauge.gershon.ai`, check `/api/health`.
Whenever `extension/` changes: bump `version` in the manifest, run `node tools/build-extension.mjs` (a test fails if the site's latest.json and the manifest differ).

- ✅ 2026-11-17 (branch `page-visitors`): 9th lever **Page visitors worked** (work group, bonus: only Page admins get a reading, otherwise left out of the average). Proxy = invitations last week × 4 ÷ company Page unique visitors (30 days), target 70. Extension v0.4.0 finds the first Page the user admins from `/company/<id>/admin` links on their feed, reads only the visitor count on `/company/<id>/admin/analytics/visitors/`. Consent v3, privacy + store text updated, worker accepts `pageVisitors`. 68 tests pass.
- ❌ Page visitors reader not checked on a live Page analytics page (parser built from LinkedIn's "Unique visitors" / Premium "Page visitors" wording).
- ❌ v0.4.0 must be uploaded to the Chrome Web Store (new review, data disclosure unchanged: website content). Deploy the site only after the store approves 0.4.0, otherwise store users are told they are "outdated".
- ❌ Proxy formula is Claude's proposal; not yet confirmed by Olivier.
- ❌ `dist/gauge-extension-0.4.0.zip` and `site/downloads/gauge-extension-0.4.0.zip` not yet on the branch (the GitHub connector cannot push binary files): run `node tools/build-extension.mjs` and commit both before merging; until then the release test fails on a fresh clone.

- ✅ 2026-11-18 (branch `page-visitors`, PR #3, on Olivier's "All 3"): grade reader fixes — saved accounts total read from "Search in saved accounts (N)"; groups reader presses "Show more results" until all groups are listed (disclosed in consent, privacy, store pack); reading window is now a small unfocused window behind the user's (not minimized), so LinkedIn loads the full sent-invitations list. ❌ At merge time also set `APP_VERSION` in site/_worker.js to 0.4.0 (the health-version test fails on this branch until then, like the zip test).
- ✅ 2026-11-18 (main, PR #6 merged f796055): campaign links `gauge.gershon.ai/?src=<name>` (e.g. `?src=spotlight`): 30-day `gauge_src` cookie, anonymous counters in KV `camp:<src>` (visit / report / signin / saved), `POST /api/event {type:"report"}` from the report page, member.src on sign-in, "Campaign links" table on /admin and in the daily email. Privacy policy updated. ❌ Not live until site/ is redeployed from main.
- ❌ Daily email still needs `RESEND_API_KEY` pasted in Cloudflare Pages → gauge-gershon-ai → Settings → Variables and secrets (Production), then a redeploy.

- ✅ 2026-11-23 (extension 0.5.0 + site): install detection fixed (Chrome does not inject the flag script into tabs open during install → wait 2.5 s, keep listening, auto-reload when the user comes back from the store, "I installed it — check again" button, other-profile hint); "outdated" now compares with `storeVersion` in extension-latest.json (set by hand to the version live on the store, now 0.3.0) so store users are not nagged during a review. Step 2 "Run your first sync" card with pin/notice/Grade me steps; "Last sync" bar (stale after 7 days). Every lever line, move and "not read" item links to its LinkedIn page (`site/levers-ui.js`, `source` per lever in score.js); history rows expand. Share page writes a full ROI post + opens LinkedIn's composer prefilled. Extension 0.5.0: opens the welcome page on first install; site "Sync now" relayed by site-flag.js as the same `grade` request (consent still required; notice opens in a tab if missing). No new permissions.
- ❌ 0.5.0 must replace 0.4.0 in the Chrome Web Store review (cancel the 0.4.0 review, upload dist/gauge-extension-0.5.0.zip). After approval set `storeVersion` to 0.5.0 and redeploy. Sync now only shows for 0.5.0+.

- ✅ 2026-11-24 (Olivier chose option 1): admin-only setting "Send my full LinkedIn figures to my Gershon dashboard" (Settings → My Gershon dashboard, off by default). When on, the report page sends the raw figures with the grade; the worker keeps numbers only (`cleanFigures`) in `figures:<id>`, `fighist:<id>` (≤100) and `feed:<email>`, read by tools.gershoncrm.com through a KV binding. Off or delete-me removes all three. Extension unchanged (no store review needed); privacy policy + store notes updated. 79 tests pass.
- ✅ 2026-11-24 deployed to production (main 4c1edf2, /api/health 0.5.0); setting on for olivier@attia.com. ❌ First figures arrive with the next "Grade me".

- ✅ 2026-11-24 (dashboard v2, site only, no extension change): each saved test now also keeps 3 invitation counts (`inv: {week, prevWeek, pending}`, numbers only, `cleanInvites` in the worker; sent by report.js for every signed-in user). Dashboard: "Your progress" trend chart with tabs (All / Overall / Filling / Working, hover tooltips), "Invitations sent per week" (KPI tiles + bar chart vs 100/week pace, hover details; `weeklyInvites` in game.js, one bar per ISO week, a sync's prevWeek fills a missing week), "What moved since <last test>" lever deltas. Charts in `site/charts.js`. Privacy policy updated (Nov 24). 82 tests pass.
- ✅ 2026-11-24 14:40: merged (main 334a5b6, PR #10) and deployed to production from Browser 2 (Pages zip upload, 26 files); /api/health ok 0.5.0, new app.js, charts.js and privacy (Nov 24) live.
- ❌ Weekly counts are pending invitations only (accepted ones leave LinkedIn's Sent list). Adding accepted connections needs a new page read in the extension (new store review). History starts with the next sync; older tests have no counts.
