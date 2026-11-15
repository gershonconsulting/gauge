// ---------------------------------------------------------------------------
// FUTURE HOOK — DISABLED. Posting the score to gauge.gershon.ai.
// Version 0.1.0 sends NOTHING to any server. To enable later, ALL of these are needed:
//   1. set POST_SCORE_ENABLED = true,
//   2. add "https://gauge.gershon.ai/*" to optional_host_permissions in manifest.json
//      and request it with chrome.permissions.request at the moment the user opts in,
//   3. ask the user for explicit consent in the UI, update the privacy policy and the
//      Chrome Web Store data-use disclosures (see STORE.md).
// ---------------------------------------------------------------------------
export const POST_SCORE_ENABLED = false;
export const POST_SCORE_URL = 'https://gauge.gershon.ai/api/score';

// Only aggregate numbers would ever be posted: overall %, filling %, working %, letter, lever %.
const r0 = (x) => (x == null ? null : Math.round(x));
export function scorePayload(result) {
  const sc = result?.score || {};
  const levers = {};
  for (const [k, v] of Object.entries(sc.levers || {})) levers[k] = r0(v);
  return { v: 1, readAt: result?.readAt ?? null, overall: r0(sc.overall), filling: r0(sc.filling), working: r0(sc.working), letter: sc.letter ?? null, levers };
}

export async function postScore(result) {
  if (!POST_SCORE_ENABLED) return { sent: false, reason: 'disabled' };
  const res = await fetch(POST_SCORE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(scorePayload(result)),
  });
  return { sent: res.ok, status: res.status };
}

export const BOOK_A_CALL_URL = 'https://www.gershonconsulting.com/calendar';
export const LINKEDIN_ORIGIN = 'https://www.linkedin.com/*';
