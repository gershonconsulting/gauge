# Gauge — Chrome Web Store submission pack

Updated: 2026-11-14. Paste-ready answers for the Developer Dashboard. The extension must be built to match this file and `site/privacy.html` exactly — if the code changes, change both.

## Store listing
- Name: Gauge — Sales Navigator grader
- Summary (132 max): See how well you use LinkedIn Sales Navigator. One click, one grade, one tip per area. Read-only.
- Category: Workflow & Planning · Language: English
- Description:
  Gauge grades how efficiently you use LinkedIn Sales Navigator. Sign in at gauge.gershon.ai, click "Grade me", and get a letter grade, five area scores and one tip per area.
  Gauge reads only figures about your own activity (Social Selling Index, pending invitations, content results, saved lists and searches). It never reads your leads, contacts or messages, never sends or posts anything, and does nothing until you click.
  Gauge is an independent product by Gershon Consulting LLC and is not affiliated with or endorsed by LinkedIn Corporation.
- Homepage: https://gauge.gershon.ai · Support: https://gauge.gershon.ai/support · Privacy policy: https://gauge.gershon.ai/privacy
- Mature content: No · Ads: No · Payments: None

## Privacy tab
- Single purpose: Show the user a grade of how efficiently they use LinkedIn Sales Navigator, calculated from their own activity figures when they click "Grade me".
- Permission justifications (request nothing beyond these):
  - `activeTab` + `scripting`: read the user's own activity figures from the LinkedIn page, only after the user clicks "Grade me".
  - Host access `https://www.linkedin.com/*`: the figures are on the user's own LinkedIn and Sales Navigator pages.
  - Host access `https://gauge.gershon.ai/*`: send the figures to Gauge to calculate and show the grade, and know who is signed in.
  - `storage`: remember that the user accepted the data notice and the last grade shown.
  - Do NOT request: `tabs`, `cookies`, `webRequest`, `history`, `<all_urls>`, `identity`.
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

## Assets to produce
- Icon 128×128 (plus 16, 32, 48 in the package)
- At least 1 screenshot, 1280×800
- Small promo tile 440×280

## Reviewer notes (test instructions field)
Sign in at gauge.gershon.ai with any LinkedIn account that has Sales Navigator, open linkedin.com, click the Gauge icon, accept the notice, click "Grade me".

## Known review risk
Gauge reads LinkedIn pages; LinkedIn's terms restrict third-party extensions. Mitigations: own figures only, read-only, click-to-run, no affiliation claim. Fallback if rejected: no-extension version (SSI screenshot + questions).
