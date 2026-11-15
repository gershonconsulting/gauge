import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import '../extension/parsers.js';
import { computeScore, letterFor, invitationStats, listStats, savedSearchStats, movesFor } from '../extension/score.js';
import { leverEvidence, evidenceGroups } from '../extension/evidence.js';
import { STEPS, unreadableList, signalsFrom } from '../extension/steps.js';
import { POST_SCORE_ENABLED, postScore, scorePayload } from '../extension/config.js';

const P = globalThis.GaugeParsers;
const NOW = new Date('2026-11-14T12:00:00Z');
const ext = new URL('../extension/', import.meta.url);
const read = (f) => readFileSync(new URL(f, ext), 'utf8');

// ---------- Fixtures built from the sample strings (real account, 2026-11-14) ----------
const SSI = `Social Selling Index
Current Social Selling Index
63 out of 100
Four components of your score
17.375
Establish your professional brand
11.735
Find the right people
8.45
Engage with insights
25
Build relationships
Industry SSI rank
Top 2%
People in the Marketing & Advertising industry have an average SSI of 35.
Network SSI rank
Top 6%
People in your network have an average SSI of 31.`;

const DASHBOARD = `Your dashboard
Private to you
435 Post impressions in 7 days
30,538 Total followers
1,330 Profile viewers in 90 days
361 Search appearances
Weekly progress
4 posts
No comments yet`;

const CONTENT = `Content performance
Past 90 days
Discovery
14,615 Impressions
279% vs. prior 90 days
Engagements
Social engagements 38
Reactions 30
Comments 7
Reposts 0
Saves 1`;

const person = (i, age) => `Jane Doe${i}\nVP Sales at Acme ${i}\nSent ${age}\nWithdraw`;
const INVITES = ['Manage invitations', 'Received Sent', 'People 484',
  ...Array.from({ length: 45 }, (_, i) => person(i, '3 days ago')),
  ...Array.from({ length: 39 }, (_, i) => person(i, '4 days ago')),
  ...Array.from({ length: 36 }, (_, i) => person(i, '5 days ago')),
  ...Array.from({ length: 129 }, (_, i) => person(i, '1 week ago')),
  ...Array.from({ length: 91 }, (_, i) => person(i, '2 weeks ago')),
].join('\n');

const sysRow = (name, n, d) => `Description ${name}\t${n}\t${d}`;
const row = (name, n, d) => `${name}\t${n}\t${d}`;
const LEADS = ['Lists', 'All saved leads (7441)', 'Name\tNumber of leads\tLast updated',
  sysRow('Recommended Leads', 50, '11/13/2026'),
  sysRow('Recently Accepted Connections', 120, '11/12/2026'),
  sysRow('New Executives at Saved Accounts', 33, '11/10/2026'),
  sysRow('Saved on LinkedIn.com', 12, '11/1/2026'),
  row('CEOs France Tech', 412, '11/2/2026'),
  row('CES 2026 exhibitors', 95, '10/20/2026'),
  ...Array.from({ length: 14 }, (_, i) => row(`Campaign list ${i}`, 100 + i, '6/1/2026')),
].join('\n');

const ACCOUNTS = ['Lists', 'Search in saved accounts (10000)', 'Name\tNumber of accounts\tLast updated',
  ...Array.from({ length: 11 }, (_, i) => row(`Accounts ${i}`, 300 + i, '8/15/2026')),
].join('\n');

const SAVED_SEARCHES = `Saved searches
CEO SaaS NY
508 new results since 8/25/2026
Edit
CMO retail
12 new results since 11/1/2026
Edit
Founders Miami
3 new results since 10/30/2026
Edit`;

const INBOX = 'Inbox\nInMail credits: 0 left\nFilter';

const pages = {
  ssi: { state: 'ok', data: P.parseSsi(SSI) },
  dashboard: { state: 'ok', data: P.parseDashboard(DASHBOARD) },
  content: { state: 'ok', data: P.parseContent(CONTENT) },
  invitations: { state: 'ok', data: P.parseInvitations(INVITES) },
  leadLists: { state: 'ok', data: P.parseLeadLists(LEADS) },
  accountLists: { state: 'ok', data: P.parseAccountLists(ACCOUNTS) },
  savedSearches: { state: 'ok', data: P.parseSavedSearches(SAVED_SEARCHES, 45) },
  inbox: { state: 'ok', data: P.parseInbox(INBOX) },
};

// ---------- Parsers ----------
test('parseSsi reads score, four parts, ranks and averages', () => {
  assert.deepEqual(P.parseSsi(SSI), {
    score: 63, brand: 17.375, findPeople: 11.735, insights: 8.45, relationships: 25,
    industryRankTopPct: 2, networkRankTopPct: 6, industryAvg: 35, networkAvg: 31,
  });
  // one-line variant as in the brief
  const one = P.parseSsi('Current Social Selling Index 63 out of 100 17.375  Establish your professional brand 25  Build relationships');
  assert.equal(one.score, 63); assert.equal(one.brand, 17.375); assert.equal(one.relationships, 25); assert.equal(one.insights, null);
});

test('parseDashboard reads the four numbers and weekly progress', () => {
  assert.deepEqual(P.parseDashboard(DASHBOARD), {
    postImpressions7d: 435, followers: 30538, profileViewers90d: 1330, searchAppearances: 361,
    postsThisWeek: 4, commentsThisWeek: 0,
  });
  assert.equal(P.parseDashboard('Weekly progress\nNo posts yet\n2 comments').postsThisWeek, 0);
  assert.equal(P.parseDashboard('Weekly progress\nNo posts yet\n2 comments').commentsThisWeek, 2);
});

test('parseContent reads the 90-day numbers', () => {
  assert.deepEqual(P.parseContent(CONTENT), {
    impressions: 14615, impressionsChangePct: 279, engagements: 38, reactions: 30, comments: 7, reposts: 0, saves: 1,
  });
});

test('parseInvitations buckets by age and keeps no names', () => {
  const inv = P.parseInvitations(INVITES);
  assert.deepEqual(inv, { total: 484, rowsRead: 340, ageCounts: { '3d': 45, '4d': 39, '5d': 36, '1w': 129, '2w': 91 } });
  assert.doesNotMatch(JSON.stringify(inv), /Jane|Acme|VP Sales/);
  const b = P.parseInvitations('People (3)\nSent today\nSent yesterday\nSent 1 month ago');
  assert.deepEqual(b.ageCounts, { '0d': 1, '1d': 1, '1m': 1 });
  assert.equal(b.total, 3);
});

test('parseLeadLists / parseAccountLists keep counts and dates only, flag system lists', () => {
  const l = P.parseLeadLists(LEADS);
  assert.equal(l.total, 7441);
  assert.equal(l.rows.length, 20);
  assert.equal(l.rows.filter((r) => r.system).length, 4);
  assert.deepEqual(l.rows[4], { count: 412, updated: '2026-11-02', system: false });
  assert.doesNotMatch(JSON.stringify(l), /CEOs|CES|Campaign|Recommended/);
  const a = P.parseAccountLists(ACCOUNTS);
  assert.equal(a.total, 10000);
  assert.equal(a.rows.length, 11);
  assert.ok(a.rows.every((r) => !r.system && r.updated === '2026-08-15'));
  // rows split over several lines
  const multi = P.parseLeadLists('All saved leads (5)\nMy list\n42\n11/3/2026\nDescription Recommended Leads\n7\n11/4/2026');
  assert.deepEqual(multi.rows, [{ count: 42, updated: '2026-11-03', system: false }, { count: 7, updated: '2026-11-04', system: true }]);
});

test('parseSavedSearches counts Edit buttons and collects new-result counts and since-dates', () => {
  const s = P.parseSavedSearches(SAVED_SEARCHES, 45);
  assert.equal(s.count, 45);
  assert.deepEqual(s.newResults, [
    { count: 508, since: '2026-08-25' }, { count: 12, since: '2026-11-01' }, { count: 3, since: '2026-10-30' },
  ]);
  assert.doesNotMatch(JSON.stringify(s), /CEO SaaS|Miami/);
  assert.equal(P.parseSavedSearches(SAVED_SEARCHES).count, 3); // no DOM count: falls back to entries
});

test('parseInbox reads InMail credits', () => {
  assert.deepEqual(P.parseInbox(INBOX), { inmailLeft: 0 });
  assert.deepEqual(P.parseInbox('InMail credits: 1,234 left'), { inmailLeft: 1234 });
});

test('parsers return null fields instead of throwing on missing or junk input', () => {
  for (const input of [undefined, null, '', 'Loading…', 42]) {
    assert.ok(Object.values(P.parseSsi(input)).every((v) => v === null));
    assert.ok(Object.values(P.parseDashboard(input)).every((v) => v === null));
    assert.ok(Object.values(P.parseContent(input)).every((v) => v === null));
    assert.deepEqual(P.parseInvitations(input), { total: null, rowsRead: 0, ageCounts: {} });
    assert.deepEqual(P.parseLeadLists(input), { total: null, rows: [] });
    assert.deepEqual(P.parseAccountLists(input), { total: null, rows: [] });
    assert.deepEqual(P.parseSavedSearches(input), { count: null, newResults: [] });
    assert.deepEqual(P.parseInbox(input), { inmailLeft: null });
  }
});

test('detectPageState spots signed-out and no-Sales-Navigator pages', () => {
  assert.equal(P.detectPageState('https://www.linkedin.com/login?session_redirect=x', '', 'ssi'), 'signed_out');
  assert.equal(P.detectPageState('https://www.linkedin.com/authwall?trk=1', '', 'dashboard'), 'signed_out');
  assert.equal(P.detectPageState('https://www.linkedin.com/sales/ssi', 'Sign in\nJoin now\nWelcome', 'ssi'), 'signed_out');
  assert.equal(P.detectPageState('https://www.linkedin.com/premium/products/?upsell=sales', 'Premium', 'leadLists'), 'no_sales_nav');
  assert.equal(P.detectPageState('https://www.linkedin.com/sales/inbox', 'Start your free trial of Sales Navigator', 'inbox'), 'no_sales_nav');
  assert.equal(P.detectPageState('https://www.linkedin.com/sales/ssi', SSI, 'ssi'), 'ok');
  assert.equal(P.detectPageState('https://www.linkedin.com/sales/lists/people', LEADS, 'leadLists'), 'ok');
});

test('readiness checks ignore skeleton pages', () => {
  assert.equal(P.ready.leadLists('All saved leads (7441)\nName\tNumber of leads\tLast updated\n\t\t'), false);
  assert.equal(P.ready.leadLists(LEADS), true);
  assert.equal(P.ready.ssi(SSI), true);
  assert.equal(P.ready.invitations(INVITES), true);
  assert.equal(P.ready.inbox(INBOX), true);
});

// ---------- Score ----------
test('reference account: levers 100,100,100,74,47,34,7 -> filling 94, working 29, overall 66, C+', () => {
  const sc = computeScore(signalsFrom(pages), NOW);
  const L = sc.levers;
  assert.deepEqual(
    ['inmail', 'invitations', 'savedAccounts', 'savedLeads', 'ssiFindPeople', 'ssiInsights', 'listsFresh'].map((k) => Math.round(L[k])),
    [100, 100, 100, 74, 47, 34, 7]);
  assert.equal(Math.round(sc.filling), 94);
  assert.ok(Math.abs(sc.filling - 93.6) < 0.05);
  assert.equal(Math.round(sc.working), 29);
  assert.equal(Math.round(sc.overall), 66);
  assert.equal(sc.letter, 'C+');
});

test('invitations: last 13 days / 2 per week against 100/week', () => {
  const s = invitationStats(pages.invitations.data);
  assert.equal(s.last13d, 249);
  assert.equal(s.perWeek, 124.5);
  assert.equal(s.total, 484);
  assert.equal(computeScore({ invitations: { total: 60, ageCounts: { '2d': 50, '3w': 10 } } }).levers.invitations, 25);
});

test('lists fresh share and saved-search evidence', () => {
  const l = listStats(pages.leadLists.data, pages.accountLists.data, NOW);
  assert.deepEqual(l, { custom: 27, fresh30d: 2, shareFresh: 2 / 27 });
  const ss = savedSearchStats(pages.savedSearches.data, NOW);
  assert.deepEqual(ss, { count: 45, dated: 3, opened30d: 2, shareOpened30d: 2 / 3 });
});

test('InMail: 50/month assumption, unknown -> null', () => {
  assert.equal(computeScore({ inbox: { inmailLeft: 25 } }).levers.inmail, 50);
  assert.equal(computeScore({ inbox: { inmailLeft: 80 } }).levers.inmail, 0);
  assert.equal(computeScore({ inbox: { inmailLeft: null } }).levers.inmail, null);
});

test('null levers are skipped; nothing read -> no score', () => {
  const sc = computeScore({ ssi: { findPeople: 12.5, insights: null } });
  assert.equal(sc.levers.ssiFindPeople, 50);
  assert.equal(sc.filling, null);
  assert.equal(sc.working, 50);
  assert.equal(sc.overall, 50);
  const none = computeScore({});
  assert.equal(none.overall, null);
  assert.equal(none.letter, null);
  assert.deepEqual(none.moves, []);
});

test('letter bands with +/- thirds', () => {
  const cases = [[100, 'A+'], [95, 'A+'], [90, 'A'], [85, 'A−'], [84.9, 'B+'], [75, 'B'], [70, 'B−'],
    [66.08, 'C+'], [55, 'C−'], [54, 'D+'], [40, 'D−'], [39.9, 'F'], [0, 'F']];
  for (const [s, l] of cases) assert.equal(letterFor(s), l, `score ${s}`);
  assert.equal(letterFor(null), null);
});

test('moves that add the most: top 3 gaps, points = gap / 7', () => {
  const sc = computeScore(signalsFrom(pages), NOW);
  assert.deepEqual(sc.moves.map((m) => m.key), ['listsFresh', 'ssiInsights', 'ssiFindPeople']);
  assert.equal(Math.round(sc.moves[0].points), 13);
  assert.equal(Math.round(sc.moves[1].points), 9);
  assert.equal(Math.round(sc.moves[2].points), 8);
  assert.equal(movesFor({ inmail: 100 }).length, 0);
});

// ---------- Report model ----------
test('lever evidence and evidence groups', () => {
  const sig = signalsFrom(pages);
  const sc = computeScore(sig, NOW);
  const ev = leverEvidence(sig, sc);
  assert.equal(ev.savedLeads, '7,441 of 10,000');
  assert.equal(ev.savedAccounts, '10,000 of 10,000');
  assert.equal(ev.listsFresh, '2 of 27 lists updated in the last 30 days');
  assert.match(ev.inmail, /^0 of 50 credits left/);
  const groups = evidenceGroups(sig, sc);
  assert.deepEqual(groups.map((g) => g.title), ['Social Selling Index', 'Pending invitations by age', 'Content, last 90 days', 'Saved searches']);
  const inv = groups[1].lines.map((l) => `${l.label}: ${l.value}`);
  assert.deepEqual(inv, ['Pending in total: 484', 'Sent 3 days ago: 45', 'Sent 4 days ago: 39', 'Sent 5 days ago: 36',
    'Sent 1 week ago: 129', 'Sent 2 weeks ago: 91', 'Not loaded (older): 144']);
  assert.ok(groups[3].lines.some((l) => l.value === '2 of 3 (67%)'));
});

test('unreadable list and partial results', () => {
  const partial = { ssi: pages.ssi, dashboard: { state: 'timeout', data: null }, leadLists: { state: 'no_sales_nav', data: null } };
  const u = unreadableList(partial);
  assert.equal(u.length, STEPS.length - 1);
  assert.match(u.find((x) => x.page === 'leadLists').reason, /Sales Navigator/);
  assert.match(u.find((x) => x.page === 'dashboard').reason, /did not finish/);
  assert.deepEqual(unreadableList(pages), []);
  const sc = computeScore(signalsFrom(partial), NOW);
  assert.equal(Math.round(sc.overall), Math.round((46.94 + 33.8) / 2));
});

// ---------- Store compliance ----------
test('manifest: MV3, minimal permissions, no broad hosts', () => {
  const m = JSON.parse(read('manifest.json'));
  assert.equal(m.manifest_version, 3);
  assert.equal(m.version, '0.1.0');
  assert.equal(m.name, 'Gauge — Sales Navigator grader');
  assert.deepEqual(m.permissions, ['scripting', 'storage']);
  assert.deepEqual(m.optional_host_permissions, ['https://www.linkedin.com/*']);
  assert.equal(m.host_permissions, undefined);
  assert.equal(m.content_scripts, undefined);
  assert.equal(m.background.service_worker, 'sw.js');
  for (const s of [16, 48, 128]) {
    const png = readFileSync(new URL(m.icons[s], ext));
    assert.equal(png.toString('latin1', 1, 4), 'PNG');
    assert.equal(png.readUInt32BE(16), s);
  }
  const all = JSON.stringify(m);
  assert.doesNotMatch(all, /<all_urls>|\*:\/\/\*|webRequest|cookies|"tabs"|history|debugger/);
});

test('code: no eval, no remote scripts, no voyager API, no network unless the disabled hook', () => {
  const files = readdirSync(ext).filter((f) => /\.(js|html)$/.test(f));
  for (const f of files) {
    const src = read(f);
    assert.doesNotMatch(src, /\beval\s*\(|new Function\s*\(|setTimeout\s*\(\s*['"`]/, f);
    assert.doesNotMatch(src, /<script[^>]+src=["']https?:/i, f);
    assert.doesNotMatch(src, /voyager/i, f);
    assert.doesNotMatch(src, /XMLHttpRequest|WebSocket|sendBeacon/, f);
    if (f !== 'config.js') assert.doesNotMatch(src, /\bfetch\s*\(/, f);
    if (f.endsWith('.html')) assert.doesNotMatch(src, /<script(?![^>]*\bsrc=)[^>]*>/i, `${f} has an inline script`);
  }
});

test('posting hook is disabled and only carries aggregate numbers', async () => {
  assert.equal(POST_SCORE_ENABLED, false);
  const result = { readAt: NOW.toISOString(), score: computeScore(signalsFrom(pages), NOW), pages };
  assert.deepEqual(await postScore(result), { sent: false, reason: 'disabled' });
  const p = scorePayload(result);
  assert.deepEqual(Object.keys(p).sort(), ['filling', 'letter', 'levers', 'overall', 'readAt', 'v', 'working']);
  assert.equal(p.overall, 66);
  assert.ok(Object.values(p.levers).every((v) => typeof v === 'number'));
});

test('steps: 8 LinkedIn pages, only linkedin.com, saved searches optional', () => {
  assert.equal(STEPS.length, 8);
  assert.ok(STEPS.every((s) => s.url.startsWith('https://www.linkedin.com/')));
  assert.ok(STEPS.every((s) => typeof P.ready[s.page] === 'function'));
  assert.deepEqual(STEPS.filter((s) => s.optional).map((s) => s.page), ['savedSearches']);
});
