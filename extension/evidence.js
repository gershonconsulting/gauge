// Evidence text for the report: pure, numbers only.
import { INMAIL_PER_MONTH, SAVED_CAP, ageKeyDays } from './score.js';

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
export const fmt = (n, d = 0) => (isNum(n) ? n.toLocaleString('en-US', { maximumFractionDigits: d }) : null);
const pct = (x, d = 0) => (isNum(x) ? `${(x * 100).toFixed(d)}%` : null);

// One evidence string per lever (null when not read).
export function leverEvidence(signals, score) {
  const s = signals || {};
  const inv = score?.derived?.invitations;
  const lists = score?.derived?.lists;
  const left = s.inbox?.inmailLeft;
  return {
    inmail: isNum(left) ? `${fmt(left)} of ${INMAIL_PER_MONTH} credits left (assumed ${INMAIL_PER_MONTH}/month)` : null,
    invitations: inv ? `${fmt(inv.last13d)} pending sent in the last 13 days (${fmt(inv.perWeek, 1)}/week vs 100/week)` : null,
    savedAccounts: isNum(s.accountLists?.total) ? `${fmt(s.accountLists.total)} of ${fmt(SAVED_CAP)}` : null,
    savedLeads: isNum(s.leadLists?.total) ? `${fmt(s.leadLists.total)} of ${fmt(SAVED_CAP)}` : null,
    ssiFindPeople: isNum(s.ssi?.findPeople) ? `${fmt(s.ssi.findPeople, 2)} of 25` : null,
    ssiInsights: isNum(s.ssi?.insights) ? `${fmt(s.ssi.insights, 2)} of 25` : null,
    listsFresh: lists ? `${fmt(lists.fresh30d)} of ${fmt(lists.custom)} lists updated in the last 30 days` : null,
  };
}

const AGE_LABEL = (k) => {
  const m = /^(\d+)([dwmy])$/.exec(k);
  if (!m) return k;
  if (k === '0d') return 'today';
  const unit = { d: 'day', w: 'week', m: 'month', y: 'year' }[m[2]];
  return `${m[1]} ${unit}${m[1] === '1' ? '' : 's'} ago`;
};

// Evidence groups shown below the levers: [{ title, lines: [{label, value}] }]
export function evidenceGroups(signals, score) {
  const s = signals || {};
  const ssi = s.ssi || {};
  const c = s.content || {};
  const d = s.dashboard || {};
  const inv = score?.derived?.invitations;
  const ss = score?.derived?.savedSearches;
  const L = (label, value) => (value == null ? null : { label, value: String(value) });
  const groups = [];

  groups.push({ title: 'Social Selling Index', lines: [
    L('SSI', isNum(ssi.score) ? `${fmt(ssi.score)} / 100` : null),
    L('Establish your professional brand', isNum(ssi.brand) ? `${fmt(ssi.brand, 2)} / 25` : null),
    L('Find the right people', isNum(ssi.findPeople) ? `${fmt(ssi.findPeople, 2)} / 25` : null),
    L('Engage with insights', isNum(ssi.insights) ? `${fmt(ssi.insights, 2)} / 25` : null),
    L('Build relationships', isNum(ssi.relationships) ? `${fmt(ssi.relationships, 2)} / 25` : null),
    L('Industry rank', isNum(ssi.industryRankTopPct) ? `Top ${fmt(ssi.industryRankTopPct)}%` : null),
    L('Network rank', isNum(ssi.networkRankTopPct) ? `Top ${fmt(ssi.networkRankTopPct)}%` : null),
    L('Industry average SSI', fmt(ssi.industryAvg)),
    L('Network average SSI', fmt(ssi.networkAvg)),
  ] });

  const ages = Object.entries(s.invitations?.ageCounts || {})
    .sort((a, b) => (ageKeyDays(a[0]) ?? 1e9) - (ageKeyDays(b[0]) ?? 1e9))
    .map(([k, n]) => L(`Sent ${AGE_LABEL(k)}`, fmt(n)));
  const unread = inv && inv.total > inv.rowsRead ? inv.total - inv.rowsRead : 0;
  groups.push({ title: 'Pending invitations by age', lines: [
    L('Pending in total', fmt(inv?.total)),
    ...ages,
    unread ? L('Not loaded (older)', fmt(unread)) : null,
  ] });

  groups.push({ title: 'Content, last 90 days', lines: [
    L('Impressions', fmt(c.impressions)),
    L('Change vs prior 90 days', isNum(c.impressionsChangePct) ? `${fmt(c.impressionsChangePct)}%` : null),
    L('Social engagements', fmt(c.engagements)),
    L('Reactions', fmt(c.reactions)),
    L('Comments', fmt(c.comments)),
    L('Reposts', fmt(c.reposts)),
    L('Saves', fmt(c.saves)),
    L('Engagement rate', isNum(c.engagements) && c.impressions > 0 ? pct(c.engagements / c.impressions, 2) : null),
    L('Posts this week', fmt(d.postsThisWeek)),
    L('Followers', fmt(d.followers)),
    L('Profile viewers (90 days)', fmt(d.profileViewers90d)),
  ] });

  groups.push({ title: 'Saved searches', lines: [
    L('Saved searches', fmt(ss?.count)),
    L('Opened in the last 30 days', ss && ss.shareOpened30d != null ? `${fmt(ss.opened30d)} of ${fmt(ss.dated)} (${pct(ss.shareOpened30d)})` : null),
  ] });

  for (const g of groups) g.lines = g.lines.filter(Boolean);
  return groups.filter((g) => g.lines.length);
}
