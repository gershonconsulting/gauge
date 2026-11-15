// Gauge scoring: pure functions. signals (from parsers) + now -> capacity score.
// Headline: "You are using N% of your Sales Navigator capacity".
// Seven levers, each 0–100; null levers (not read) are skipped.
//   FILLING: inmail, invitations, savedAccounts, savedLeads
//   WORKING: ssiFindPeople, ssiInsights, listsFresh
// filling = mean(FILLING), working = mean(WORKING), overall = mean of all seven.

export const INMAIL_PER_MONTH = 50;     // assumed monthly InMail allowance
export const INVITES_PER_WEEK = 100;    // invitation target
export const SAVED_CAP = 10000;         // Sales Navigator saved leads / accounts limit

const clamp = (x) => Math.max(0, Math.min(100, x));
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const mean = (xs) => {
  const v = xs.filter(isNum);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const DAY = 86400000;
const UNIT_DAYS = { d: 1, w: 7, m: 30, y: 365 };
const ms = (now) => (now instanceof Date ? now.getTime() : +now);
const ageDays = (iso, now) => (iso ? (ms(now) - Date.parse(iso + 'T00:00:00Z')) / DAY : null);

export function ageKeyDays(key) {
  const m = /^(\d+)([dwmy])$/.exec(key);
  return m ? +m[1] * UNIT_DAYS[m[2]] : null;
}

// Pending invitations summary from age buckets ("3d", "1w", ...).
export function invitationStats(inv) {
  if (!inv) return null;
  let last13d = 0, read = 0;
  for (const [k, n] of Object.entries(inv.ageCounts || {})) {
    const d = ageKeyDays(k);
    if (d == null) continue;
    read += n;
    if (d < 14) last13d += n; // "today".."6 days ago" and "1 week ago"
  }
  // The sent list is newest first, so rows not read (lazy-load stalled) are older ones.
  const total = isNum(inv.total) ? Math.max(inv.total, read) : read;
  return { total, rowsRead: read, last13d, perWeek: last13d / 2 };
}

export function listStats(leadLists, accountLists, now) {
  if (!leadLists && !accountLists) return null;
  const custom = [leadLists, accountLists].filter(Boolean).flatMap((l) => l.rows || []).filter((r) => !r.system);
  const fresh = custom.filter((r) => { const a = ageDays(r.updated, now); return a != null && a <= 30; });
  return { custom: custom.length, fresh30d: fresh.length, shareFresh: custom.length ? fresh.length / custom.length : 0 };
}

// Evidence only (not scored): saved searches whose "since" date is in the last 30 days.
export function savedSearchStats(ss, now) {
  if (!ss) return null;
  const dated = (ss.newResults || []).filter((r) => r.since);
  const recent = dated.filter((r) => ageDays(r.since, now) <= 30);
  return {
    count: isNum(ss.count) ? ss.count : null,
    dated: dated.length,
    opened30d: recent.length,
    shareOpened30d: dated.length ? recent.length / dated.length : null,
  };
}

export function letterFor(score) {
  if (!isNum(score)) return null;
  const bands = [['A', 85, 100], ['B', 70, 85], ['C', 55, 70], ['D', 40, 55]];
  for (const [l, lo, hi] of bands) {
    if (score >= lo) {
      const pos = (Math.min(score, hi) - lo) / (hi - lo);
      return l + (pos >= 2 / 3 ? '+' : pos < 1 / 3 ? '−' : '');
    }
  }
  return 'F';
}

export const LEVERS = [
  { key: 'inmail', group: 'filling', label: 'InMail credits used',
    move: 'Use your InMail credits every month; unused credits are capacity you pay for and lose.' },
  { key: 'invitations', group: 'filling', label: 'Invitations sent',
    move: 'Send about 100 personalised invitations a week, every week.' },
  { key: 'savedAccounts', group: 'filling', label: 'Saved accounts',
    move: 'Save the accounts that match your ideal customer, up to the 10,000 limit.' },
  { key: 'savedLeads', group: 'filling', label: 'Saved leads',
    move: 'Save the decision-makers at your target accounts as leads, up to the 10,000 limit.' },
  { key: 'ssiFindPeople', group: 'working', label: 'SSI: Find the right people',
    move: 'Use advanced search filters and save focused searches so Sales Navigator finds the right people for you.' },
  { key: 'ssiInsights', group: 'working', label: 'SSI: Engage with insights',
    move: 'Post weekly and comment on your leads’ posts; this is what lifts "Engage with insights".' },
  { key: 'listsFresh', group: 'working', label: 'Lists kept up to date',
    move: 'Review and update every custom lead and account list at least once a month.' },
];

export function computeScore(signals, now = new Date()) {
  const s = signals || {};
  const ssi = s.ssi || {};
  const inv = invitationStats(s.invitations);
  const lists = listStats(s.leadLists, s.accountLists, now);
  const left = s.inbox?.inmailLeft;

  const levers = {
    inmail: isNum(left) ? clamp(((INMAIL_PER_MONTH - left) / INMAIL_PER_MONTH) * 100) : null,
    invitations: inv ? clamp((inv.perWeek / INVITES_PER_WEEK) * 100) : null,
    savedAccounts: isNum(s.accountLists?.total) ? clamp((s.accountLists.total / SAVED_CAP) * 100) : null,
    savedLeads: isNum(s.leadLists?.total) ? clamp((s.leadLists.total / SAVED_CAP) * 100) : null,
    ssiFindPeople: isNum(ssi.findPeople) ? clamp((ssi.findPeople / 25) * 100) : null,
    ssiInsights: isNum(ssi.insights) ? clamp((ssi.insights / 25) * 100) : null,
    listsFresh: lists ? clamp(lists.shareFresh * 100) : null,
  };
  const of = (g) => LEVERS.filter((l) => l.group === g).map((l) => levers[l.key]);
  const overall = mean(Object.values(levers));
  return {
    overall,
    filling: mean(of('filling')),
    working: mean(of('working')),
    letter: letterFor(overall),
    levers,
    moves: movesFor(levers),
    derived: { invitations: inv, lists, savedSearches: savedSearchStats(s.savedSearches, now) },
  };
}

// Up to three levers with the biggest gap; points = gap closed / 7 (effect on overall).
export function movesFor(levers, max = 3) {
  return LEVERS
    .filter((l) => isNum(levers[l.key]) && levers[l.key] < 100)
    .map((l) => ({ key: l.key, label: l.label, move: l.move, gap: 100 - levers[l.key], points: (100 - levers[l.key]) / LEVERS.length }))
    .sort((a, b) => b.gap - a.gap)
    .slice(0, max);
}
