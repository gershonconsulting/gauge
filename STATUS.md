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
- ❌ Secrets not set in Cloudflare: `LINKEDIN_CLIENT_SECRET`, `SESSION_SECRET` (a person must paste them; never commit them)
- ❌ Chrome extension (read-only, click-to-run, linkedin.com + gauge.gershon.ai only) not built
- ❌ Grade report page in the site (the prototype's layout, fed by the extension)
- ❌ Chrome Web Store submission (privacy policy final text, permission justifications, listing)
- ❌ Not measurable yet: invitation acceptance rate (needs two readings), message reply rate

## LinkedIn app
- Client ID `86rofazxdl07cq` (public). Redirect URL registered: `https://gauge.gershon.ai/api/auth/linkedin/callback`
- The site asks only for `openid profile email`. The app also has `w_member_social` (post on your behalf); Gauge never uses it — remove that product from the LinkedIn app before store review.

## Deploy route
Cloudflare Pages, deploy root = `site/` (`_worker.js` at its root, advanced mode). Project name suggested: `gauge-gershon-ai`.
After first deploy: add the two secrets (Production), redeploy, attach custom domain `gauge.gershon.ai`, check `/api/health` shows both flags true.

## Scoring (prototype, Claude's proposal, not confirmed)
Five areas, equal weight: Relationships, Outreach, Professional brand, Prospecting, Content. A ≥85, B ≥70, C ≥55, D ≥40.
