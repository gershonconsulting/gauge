# Gauge — status

Updated: 2026-11-14 · Site: https://gauge.gershon.ai · Repo: gershonconsulting/gauge (main)

## What it is
"How good are you with Sales Navigator?" Sign in with LinkedIn, get a grade. Independent app (not Radar).
First Gershon app to go through Chrome Web Store review.

## State
- ✅ Site + LinkedIn sign-in code (`site/`): landing page, `/api/auth/linkedin/start`, `/api/auth/linkedin/callback`, `/api/me`, `/api/auth/logout`, `/api/health`, privacy page draft
- ✅ Tests: `npm test` (7 passing, Node 22)
- ✅ Signal check on Olivier's own LinkedIn: SSI + 4 parts, pending invitations by age, 90-day content analytics, saved leads/accounts/searches, list freshness, InMail credits are all readable. Grade prototype published as a Claude artifact (his data is NOT in this repo).
- ❌ Not deployed: gauge.gershon.ai does not load yet (no Pages project / DNS)
- ❌ Secret not set in Cloudflare: `LINKEDIN_CLIENT_SECRET` (a person must paste it; never commit it). The session key is derived from it, so it is the only secret.
- ✅ Chrome extension v0.1.0 code (`extension/`, branch `extension`, not merged): MV3, `scripting` + `storage`, linkedin.com as optional host permission asked at click time; reads 8 pages, scores "% of Sales Navigator capacity" (7 levers, filling/working), report + popup, nothing sent. Tests: `test/extension.test.mjs` (parsers on sample-text fixtures, scoring reference 66% C+, manifest/code compliance)
- ❌ Extension not yet run on a real LinkedIn account (only unit-tested on sample text); selectors/wait logic, invitation scrolling and the saved-searches click are unverified live
- ❌ Extension store package: privacy policy text for the extension, listing, screenshots; review `extension/STORE.md`
- ❌ Grade report page in the site (the prototype's layout, fed by the extension)
- ❌ Chrome Web Store submission (privacy policy final text, permission justifications, listing)
- ❌ Not measurable yet: invitation acceptance rate (needs two readings), message reply rate

## LinkedIn app
- Client ID `86rofazxdl07cq` (public). Redirect URL registered: `https://gauge.gershon.ai/api/auth/linkedin/callback`
- The site asks only for `openid profile email`. The app also has `w_member_social` (post on your behalf); Gauge never uses it — remove that product from the LinkedIn app before store review.

## Deploy route
Cloudflare Pages, deploy root = `site/` (`_worker.js` at its root, advanced mode). Project name suggested: `gauge-gershon-ai`.
After first deploy: add the secret (Production), redeploy, attach custom domain `gauge.gershon.ai`, check `/api/health` shows `linkedinSecretSet` and `sessionKeyReady` true.

## Scoring (extension v0.1.0)
"You are using N% of your Sales Navigator capacity": 7 levers. Filling = InMail used, invitations/week, saved accounts, saved leads. Working = SSI find people, SSI insights, lists updated in 30 days. A ≥85, B ≥70, C ≥55, D ≥40.
