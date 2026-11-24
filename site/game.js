// Gauge — gamification rules. Pure functions shared by the /app pages (browser) and the tests (Node).
// Levels, weekly streak, personal best, invite badges, and the extension version check.

export const LEVELS = [
  { name: 'Starter', min: 0 },
  { name: 'Builder', min: 40 },
  { name: 'Operator', min: 55 },
  { name: 'Pro', min: 70 },
  { name: 'Master', min: 85 },
];

// Level for an overall % (0–100). Returns the level and, unless at the top, the next one and the points to it.
export function levelFor(overall) {
  if (!Number.isFinite(overall)) return null;
  const v = Math.max(0, Math.min(100, overall));
  let i = 0;
  for (let k = 0; k < LEVELS.length; k++) if (v >= LEVELS[k].min) i = k;
  const next = LEVELS[i + 1] || null;
  return { name: LEVELS[i].name, index: i, next: next ? next.name : null, toNext: next ? next.min - v : 0 };
}

// ISO-8601 week key, e.g. "2026-W46".
export function isoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const year = d.getUTCFullYear();
  const week = Math.ceil(((d - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

// Consecutive ISO weeks with at least one saved test, counting back from the current week,
// or from the previous week if there is no test yet this week (the streak is still alive).
export function weeklyStreak(dates, now = new Date()) {
  const weeks = new Set();
  for (const x of dates || []) {
    const d = new Date(x);
    if (!Number.isNaN(d.getTime())) weeks.add(isoWeek(d));
  }
  const WEEK = 7 * 86400000;
  let t = now.getTime();
  if (!weeks.has(isoWeek(new Date(t)))) t -= WEEK;
  let n = 0;
  while (weeks.has(isoWeek(new Date(t)))) { n++; t -= WEEK; }
  return n;
}

// Best overall in a history list ([{at, overall}]). Ties go to the earliest test.
export function personalBest(items) {
  let best = null;
  for (const it of items || []) {
    if (!Number.isFinite(it?.overall)) continue;
    if (!best || it.overall > best.overall || (it.overall === best.overall && new Date(it.at) < new Date(best.at))) best = it;
  }
  return best;
}

// True when `item` beats every earlier test (the first test counts as a personal best).
export function isPersonalBest(item, earlier) {
  if (!Number.isFinite(item?.overall)) return false;
  return (earlier || []).every((e) => !Number.isFinite(e?.overall) || item.overall > e.overall);
}

export const INVITE_BADGES = [
  { at: 1, name: 'First invite' },
  { at: 5, name: 'Connector' },
  { at: 10, name: 'Networker' },
  { at: 25, name: 'Ambassador' },
];

// Badges earned for invitees who completed a graded test.
export function inviteBadges(graded) {
  const n = Number.isFinite(graded) ? graded : 0;
  return INVITE_BADGES.map((b) => ({ ...b, earned: n >= b.at }));
}

// Compare "0.2.0"-style versions. Returns -1, 0 or 1. Missing parts count as 0; non-numeric parts as 0.
export function compareVersions(a, b) {
  const pa = String(a ?? '').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b ?? '').split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

// Extension state for the Extension page: 'unsupported' | 'missing' | 'outdated' | 'current'.
export function extensionState({ chromium, installed, latest }) {
  if (!chromium) return 'unsupported';
  if (!installed) return 'missing';
  return compareVersions(installed, latest) < 0 ? 'outdated' : 'current';
}

// "Invitations sent per week" from saved tests ([{at, inv:{week, prevWeek, pending}}], any order).
// One row per ISO week of sync (the latest sync of that week). A sync's "prevWeek" fills the week before
// when no sync was made that week. Counts are invitations still pending: accepted ones leave LinkedIn's
// Sent list, so these are floors. Newest first, at most `max` rows.
export function weeklyInvites(items, max = 8) {
  const DAY = 86400000;
  const byWeek = new Map();
  const tests = (items || []).filter((x) => x?.inv && Number.isInteger(x.inv.week) && !Number.isNaN(new Date(x.at).getTime()))
    .sort((a, b) => new Date(b.at) - new Date(a.at));
  for (const t of tests) {
    const k = isoWeek(new Date(t.at));
    if (!byWeek.has(k)) byWeek.set(k, { week: k, end: t.at, count: t.inv.week, pending: t.inv.pending ?? null, from: 'sync' });
  }
  for (const t of tests) {
    if (!Number.isInteger(t.inv.prevWeek)) continue;
    const end = new Date(new Date(t.at).getTime() - 7 * DAY);
    const k = isoWeek(end);
    if (!byWeek.has(k)) byWeek.set(k, { week: k, end: end.toISOString(), count: t.inv.prevWeek, pending: null, from: 'next' });
  }
  const rows = [...byWeek.values()].sort((a, b) => new Date(b.end) - new Date(a.end)).slice(0, max);
  const avg = rows.length ? Math.round(rows.reduce((n, r) => n + r.count, 0) / rows.length) : null;
  return { rows, avg };
}
