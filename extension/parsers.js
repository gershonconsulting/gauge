// Gauge — text readers for the user's own LinkedIn pages.
// Pure functions: each takes the visible text of one page (document.body.innerText) and returns
// the figures Gauge needs, or null for what it could not find. They never see or return names of
// leads, contacts or message content — only counts, scores and dates.

const NUM = '(\\d{1,3}(?:[,.\\u00a0 ]\\d{3})+|\\d+(?:\\.\\d+)?)';

export function toNumber(s) {
  if (s == null) return null;
  const t = String(s).trim();
  // "14,615" / "14 615" / "14.615" as thousands; "17.4" as a decimal.
  if (/^\d{1,3}([,.  ]\d{3})+$/.test(t)) return Number(t.replace(/[,.  ]/g, ''));
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

// First number that appears within `span` characters after `label` (case-insensitive).
export function numberAfter(text, label, span = 80) {
  const i = text.toLowerCase().indexOf(label.toLowerCase());
  if (i < 0) return null;
  const m = text.slice(i + label.length, i + label.length + span).match(new RegExp(NUM));
  return m ? toNumber(m[1]) : null;
}

// Last number that appears within `span` characters before `label`.
export function numberBefore(text, label, span = 40) {
  const i = text.toLowerCase().indexOf(label.toLowerCase());
  if (i < 0) return null;
  const all = [...text.slice(Math.max(0, i - span), i).matchAll(new RegExp(NUM, 'g'))];
  return all.length ? toNumber(all[all.length - 1][1]) : null;
}

const clampPart = (n) => (n != null && n >= 0 && n <= 25 ? n : null);

// linkedin.com/sales/ssi
export function parseSsi(text) {
  const parts = {
    brand: clampPart(numberAfter(text, 'professional brand', 60)),
    find: clampPart(numberAfter(text, 'find the right people', 60)),
    engage: clampPart(numberAfter(text, 'engage with insights', 60)),
    relationships: clampPart(numberAfter(text, 'build relationships', 60)),
  };
  const known = Object.values(parts).filter((v) => v != null);
  let total = numberAfter(text, 'social selling index', 120);
  if (total == null || total > 100) total = null;
  if (total == null && known.length === 4) total = Math.round(known.reduce((a, b) => a + b, 0));
  const industryTop = topPercent(text, 'industry');
  const networkTop = topPercent(text, 'network');
  if (total == null && known.length === 0) return null;
  return { total, ...parts, industryTop, networkTop };
}

// "Top 2%" closest after the word "industry" / "network" (e.g. "Industry SSI rank  Top 2%").
function topPercent(text, word) {
  const re = new RegExp(word + '[^%]{0,60}?top\\s+(\\d{1,2})\\s*%', 'i');
  const m = text.match(re);
  return m ? Number(m[1]) : null;
}

// linkedin.com/mynetwork/invitation-manager/sent/
// Ages come from lines like "Sent 3 days ago", "Sent 1 week ago", "Sent today".
export function parseInvitations(text) {
  const ages = { under1w: 0, w1: 0, w2plus: 0 };
  let read = 0;
  const re = /sent\s+(today|yesterday|(\d+)\s+(minute|hour|day|week|month|year)s?\s+ago)/gi;
  let m;
  while ((m = re.exec(text))) {
    read++;
    let days = 0;
    if (m[1].toLowerCase() === 'yesterday') days = 1;
    else if (m[2]) {
      const n = Number(m[2]);
      days = { minute: 0, hour: 0, day: n, week: n * 7, month: n * 30, year: n * 365 }[m[3].toLowerCase()];
    }
    if (days < 7) ages.under1w++;
    else if (days < 14) ages.w1++;
    else ages.w2plus++;
  }
  const pending =
    numberAfter(text, 'people (', 12) ?? numberAfter(text, 'sent (', 12) ?? numberAfter(text, 'pending invitations', 30);
  if (!read && pending == null) return null;
  return { pending: pending ?? read, read, ...ages };
}

// linkedin.com/dashboard/  (the user's own private dashboard)
export function parseDashboard(text) {
  const out = {
    impressions: numberBefore(text, 'post impressions') ?? numberBefore(text, 'impressions'),
    followers: numberBefore(text, 'followers') ?? numberAfter(text, 'followers', 20),
    profileViewers: numberBefore(text, 'profile viewers') ?? numberBefore(text, 'profile views'),
    searchAppearances: numberBefore(text, 'search appearances'),
  };
  return Object.values(out).some((v) => v != null) ? out : null;
}

// linkedin.com/analytics/creator/content/  — engagements over the period shown.
export function parseContent(text) {
  const impressions = numberBefore(text, 'impressions', 40);
  const engagements = numberBefore(text, 'engagements', 40);
  if (impressions == null && engagements == null) return null;
  return { impressions, engagements };
}

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

// Days since a date written as "Nov 3, 2026", "3 Nov 2026", "11/3/2026", "Today", "3 days ago"…
export function daysAgo(s, now = new Date()) {
  const t = s.trim().toLowerCase();
  if (t === 'today' || /just now|minute|hour/.test(t)) return 0;
  if (t === 'yesterday') return 1;
  let m = t.match(/(\d+)\s*(d|day|w|week|mo|month|y|year)s?\b/);
  if (m) return Number(m[1]) * { d: 1, day: 1, w: 7, week: 7, mo: 30, month: 30, y: 365, year: 365 }[m[2]];
  let d = null;
  if ((m = t.match(/([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/))) d = new Date(Number(m[3]), MONTHS[m[1]], Number(m[2]));
  else if ((m = t.match(/(\d{1,2})\s+([a-z]{3})[a-z]*\.?\s+(\d{4})/))) d = new Date(Number(m[3]), MONTHS[m[2]], Number(m[1]));
  else if ((m = t.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/))) d = new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]));
  else if ((m = t.match(/([a-z]{3})[a-z]*\.?\s+(\d{4})/))) d = new Date(Number(m[2]), MONTHS[m[1]], 15);
  if (!d || Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.round((now - d) / 86400000));
}

const DATE_RE =
  /\b(today|yesterday|\d+\s*(?:days?|weeks?|months?|years?)\s+ago|[A-Z][a-z]{2}[a-z]*\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+[A-Z][a-z]{2}[a-z]*\.?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{4}|[A-Z][a-z]{2}[a-z]*\.?\s+\d{4})\b/g;

// linkedin.com/sales/lists/people and /sales/lists/company
// Each custom list row shows a size ("123 leads"/"45 accounts") and a last-updated date.
// Only counts and dates are kept; list names are never returned.
export function parseLists(text, now = new Date()) {
  const rows = [];
  const re = /(\d[\d,]*)\s+(leads?|accounts?)\b/gi;
  const hits = [...text.matchAll(re)];
  for (let k = 0; k < hits.length; k++) {
    const start = hits[k].index;
    const end = k + 1 < hits.length ? hits[k + 1].index : Math.min(text.length, start + 300);
    const seg = text.slice(start, end);
    const dates = [...seg.matchAll(DATE_RE)].map((x) => daysAgo(x[1], now)).filter((x) => x != null);
    rows.push({ size: toNumber(hits[k][1]), updatedDaysAgo: dates.length ? Math.min(...dates) : null });
  }
  if (!rows.length) return null;
  return {
    lists: rows.length,
    updated30d: rows.filter((r) => r.updatedDaysAgo != null && r.updatedDaysAgo <= 30).length,
    items: rows.reduce((a, r) => a + (r.size || 0), 0),
  };
}

// Sales Navigator home or settings: InMail credits left, saved leads/accounts totals.
export function parseSalesNav(text) {
  const out = {
    inmailLeft: numberBefore(text, 'inmail credits', 30) ?? numberAfter(text, 'inmail credits', 30),
    savedLeads: numberBefore(text, 'saved leads', 30) ?? numberAfter(text, 'saved leads', 30),
    savedAccounts: numberBefore(text, 'saved accounts', 30) ?? numberAfter(text, 'saved accounts', 30),
  };
  return Object.values(out).some((v) => v != null) ? out : null;
}

// linkedin.com/groups/  ("Groups listing / Your groups / Requested / Create group").
// Each joined group shows a line such as "481,559 members" or "1 member". Only the number of such
// lines is kept; group names are never returned. `loading` is true while LinkedIn still shows
// "Loading more results" (the list lazy-loads on scroll).
export function parseGroups(text) {
  const t = String(text || '');
  if (!/your groups|groups listing/i.test(t)) return null;
  const joined = (t.match(/^\s*\d{1,3}(?:[,.  ]\d{3})*\s+members?\s*$/gim) || []).length;
  return { joined, loading: /loading more results/i.test(t) };
}
