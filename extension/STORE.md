# Gauge — Chrome Web Store notes (v0.1.0)

## Single purpose
Gauge measures how much of their own Sales Navigator capacity a LinkedIn user is using. When the user clicks "Grade me", it opens the user's own LinkedIn and Sales Navigator stats pages in one tab, reads the numbers shown there, and shows a score and report inside the extension. It does nothing else.

## Permissions (as shipped)
| Permission | Justification |
|---|---|
| `scripting` | After the user clicks "Grade me", inject the bundled `parsers.js` + `reader.js` into the LinkedIn tab Gauge opened, to read the numbers on the user's own stats pages. |
| `storage` | Keep the latest result and the progress of the current reading on this computer (`chrome.storage.local`) so the popup and report page can show them. |
| `https://www.linkedin.com/*` (optional host permission, requested at click time) | The stats Gauge reads (SSI, dashboard, content analytics, sent invitations, Sales Navigator lists, saved searches, InMail credits) are only on linkedin.com. Requested with `chrome.permissions.request` when the user presses "Grade me"; nothing is requested at install. |

Not requested: `tabs`, `activeTab`, `<all_urls>`, `cookies`, `webRequest`, `history`, any other host. No content scripts declared in the manifest. `gauge.gershon.ai` is NOT requested in this version (see "Future hook").

## Data-use disclosures (Web Store "Privacy practices" form)
- Data collected: tick **Website content** only (numbers read from the user's own LinkedIn stats pages: counts, dates, percentages). Not ticked: personally identifiable info, health, financial, authentication, personal communications, location, web history, user activity.
- The numbers stay on the user's computer (`chrome.storage.local`). They are not transmitted to Gershon or anyone else in v0.1.0.
- Certify: not sold to third parties; not used or transferred for purposes unrelated to the single purpose; not used for creditworthiness or lending.
- Remote code: **No, I am not using remote code.** All JS is bundled; no `eval`, no `new Function`, no external scripts.
- Privacy policy URL: https://gauge.gershon.ai/privacy (must be updated to describe the extension before submission).

## What a reviewer could question
1. **Reads LinkedIn pages.** Read-only, user-initiated, own account only. No LinkedIn internal (voyager) API calls; the extension reads rendered page text. Names, profile URLs and message text of contacts are parsed out in the page and never returned: only aggregate numbers leave the page context.
2. **One click on LinkedIn.** Step 7 clicks the "Saved searches" button on the Sales Navigator search page to open the dialog and count saved searches. It is optional: if the button or dialog is not found, the step is skipped.
3. **Scrolling.** On the sent-invitations page Gauge scrolls the list (no clicks) for up to 40 s so more rows load, then counts rows by age.
4. **Opens a tab automatically.** The reading tab is opened active (visible) and closed at the end; the report opens in a new tab. The user can cancel from the popup or report page, or by closing the tab.
5. **Disabled network hook.** `config.js` contains `postScore()` for a later version that would POST aggregate scores to gauge.gershon.ai. `POST_SCORE_ENABLED = false`, the manifest has no gauge.gershon.ai permission, and the function returns before any network call. Remove it before submission if the reviewer flags it, or keep it disabled.
6. **LinkedIn terms.** Reading one's own stats in one's own session is low risk, but LinkedIn's User Agreement restricts automated access; the click-to-run, read-only design and no data export are the mitigations. Decide on the listing wording ("reads your own stats pages") with that in mind.
7. **Name** contains "Sales Navigator" (a LinkedIn trademark) — descriptive use; reviewers sometimes ask for "for Sales Navigator" phrasing. Not affiliated with LinkedIn: state this in the listing.
8. `tools/make-icons.mjs` (outside `extension/`) generated the icons; it is not part of the package.

## Packaging
Zip the contents of `extension/` (manifest at the zip root). Do not include `STORE.md` if you prefer a clean package (harmless either way).
