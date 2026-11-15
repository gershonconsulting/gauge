# Gauge — Chrome Web Store submission pack

Updated: 2026-11-14 (v0.1.0 package built). Paste-ready answers for the Developer Dashboard. The extension must be built to match this file and `site/privacy.html` exactly — if the code changes, change both.

## Store listing
- Name: Gauge — Sales Navigator grader
- Summary (132 max): See how much of your LinkedIn Sales Navigator capacity you use. One click, one grade, three moves to improve. Read-only.
- Category: Workflow & Planning · Language: English
- Description:
  Gauge grades how efficiently you use LinkedIn Sales Navigator. Click the Gauge icon, then "Grade me", and see the share of your Sales Navigator capacity you really use, lever by lever, with the three moves that add the most.
  Gauge reads only figures about your own activity (Social Selling Index, pending invitations, content results, saved lists and searches). It never reads your leads, contacts or messages, never sends or posts anything, and does nothing until you click.
  Gauge is an independent product by Gershon Consulting LLC and is not affiliated with or endorsed by LinkedIn Corporation.
- Homepage: https://gauge.gershon.ai · Support: https://gauge.gershon.ai/support · Privacy policy: https://gauge.gershon.ai/privacy
- Mature content: No · Ads: No · Payments: None

## Privacy tab
- Single purpose: Show the user a grade of how efficiently they use LinkedIn Sales Navigator, calculated from their own activity figures when they click "Grade me".
- Permission justifications (the manifest requests exactly these, nothing else):
  - `scripting`: after the user clicks "Grade me", read the visible figures on the user's own LinkedIn pages that Gauge opens in a background tab.
  - `storage`: remember that the user accepted the data notice, and show reading progress in the popup.
  - Host access `https://www.linkedin.com/*`: the figures are on the user's own LinkedIn and Sales Navigator pages (SSI, sent invitations, dashboard, content analytics, Sales Navigator lists and home).
  - Not requested: `tabs`, `activeTab`, `cookies`, `webRequest`, `history`, `identity`, `<all_urls>`, no content scripts. Opening and closing its own background tab needs no extra permission.
  - No access to gauge.gershon.ai is needed: the report opens as a normal tab and the figures travel in the URL fragment (`#d=…`), which the browser never sends to the server; the grade is computed in the page.
- Remote code: No. All code ships in the package (Manifest V3, no eval, no remote scripts).
- Data collected (tick only these):
  - Personally identifiable information — name, email, LinkedIn member ID
  - User activity — the user's own LinkedIn usage figures
  - Website content — figures read from the user's own LinkedIn pages
  - Not collected: health, financial, authentication info, personal communications, location, web history
- Certifications (all three true, tick all):
  - Data is not sold or transferred to third parties outside the approved use cases
  - Data is not used or transferred for purposes unrelated to the single purpose
  - Data is not used or transferred to determine creditworthiness or for lending

## In the extension itself (required before submission)
- First run: a notice stating what is read and where it is sent, with a link to the privacy policy and an "I agree" button. No reading before agreement.
- Reads only on the user's click. No background activity, no automation, no page changes.
- HTTPS only. No obfuscated code (minification is fine).

## Developer account (Charles, in the dashboard)
- One-time USD 5 registration fee
- 2-step verification on the Google account
- Contact email verified
- Trader / non-trader declaration (EU): Trader — Gershon Consulting LLC, with business address and phone
- gauge.gershon.ai verified in Google Search Console and set as the official site

## Package and assets (ready)
- Upload package: `dist/gauge-extension-0.1.0.zip` (built from `extension/`)
- Store icon: `store/assets/store-icon-128.png` (16/32/48/128 are inside the package)
- Screenshots 1280×800: `store/assets/screenshot-1-report.png` (demo figures, not a real person), `store/assets/screenshot-2-consent.png`
- Small promo tile 440×280: `store/assets/promo-small-440x280.png`

## Reviewer notes (test instructions field)
Be signed in to LinkedIn (an account with Sales Navigator gives the full report; without it, the Sales Navigator levers are listed as "not read"). Click the Gauge toolbar icon, accept the notice, click "Grade me". Gauge opens each page in a background tab, reads it, closes it, and after about two minutes opens the report at gauge.gershon.ai/report. Signing in at gauge.gershon.ai is optional and only saves the scores.

## Known review risk
Gauge reads LinkedIn pages; LinkedIn's terms restrict third-party extensions. Mitigations: own figures only, read-only, click-to-run, no affiliation claim. Fallback if rejected: no-extension version (SSI screenshot + questions).
