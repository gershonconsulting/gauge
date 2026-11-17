import test from 'node:test';
import assert from 'node:assert/strict';
import { computeGrade, gradeFor, encodeSignals, decodeSignals } from '../site/score.js';

// Olivier's reading of 2026-11-14 (the prototype): 94% filling, 29% working, 66% overall, C+.
const olivier = {
  v: 1, readAt: '2026-11-14T20:00:00Z',
  ssi: { total: 63, brand: 17.4, find: 11.7, engage: 8.5, relationships: 25, industryTop: 2, networkTop: 6 },
  invitations: { pending: 484, read: 484, under1w: 125, w1: 124, w2plus: 235 },
  dashboard: { followers: 30538, profileViewers: 1330, searchAppearances: 361 },
  content: { impressions: 14615, engagements: 38 },
  lists: { people: { lists: 16, updated30d: 2, items: 0 }, company: { lists: 11, updated30d: 0, items: 0 } },
  salesnav: { inmailLeft: 0, savedLeads: 7441, savedAccounts: 10000 },
};

test('reproduces the prototype numbers', () => {
  const r = computeGrade(olivier);
  assert.equal(r.overall, 66);
  assert.equal(r.fill, 94);
  assert.equal(r.work, 29);
  assert.equal(r.grade, 'C+');
  assert.deepEqual(r.moves.map((m) => [m.id, m.gain]), [['lists', 6], ['engage', 4], ['find', 3]]);
  assert.equal(r.after, 79);
  assert.equal(r.afterGrade, 'B');
  assert.equal(r.kpis.engagementsPer1000, 2.6);
  assert.equal(r.kpis.oldInvitesShare, 49);
});

test('missing readings are left out, not counted as zero', () => {
  const r = computeGrade({ ssi: { find: 25, engage: 25 } });
  assert.equal(r.overall, 100);
  assert.equal(r.notRead.length, 7);
  assert.equal(computeGrade({}).overall, null);
});

test('grade bands', () => {
  assert.deepEqual([90, 85, 80, 70, 66, 55, 40, 39].map(gradeFor), ['A', 'A', 'B+', 'B', 'C+', 'C', 'D', 'F']);
});

test('signals survive the URL fragment round trip', () => {
  assert.deepEqual(decodeSignals(encodeSignals(olivier)), olivier);
  assert.equal(decodeSignals('%%%'), null);
});

// Real account reading of 2026-11-15 with the groups lever (fill: 100, 100, 100, 74, 31; work: 47, 34, 7).
test('eight levers: groups joined counts toward filling', () => {
  const r = computeGrade({
    salesnav: { inmailLeft: 0, savedAccounts: 10000, savedLeads: 7400 },
    invitations: { read: 150, under1w: 150, w2plus: 0 },
    groups: { joined: 31 },
    ssi: { find: 11.75, engage: 8.5 },
    lists: { people: { lists: 15, updated30d: 1 }, company: { lists: 0, updated30d: 0 } },
  });
  assert.deepEqual(r.levers.filter((l) => l.group === 'fill').map((l) => l.value), [100, 100, 100, 74, 31]);
  assert.deepEqual(r.levers.filter((l) => l.group === 'work').map((l) => l.value), [47, 34, 7, null]);
  assert.equal(r.levers.length, 9);
  assert.equal(r.fill, 81);
  assert.equal(r.work, 29);
  assert.equal(r.overall, 62);
  assert.equal(r.grade, 'C');
  assert.equal(r.levers.find((l) => l.id === 'groups').detail, '31 of the 100 LinkedIn allows');
  // With groups at target 70 like the other fill levers, groups (+4.9) enters the top three; the
  // owner's reference (lists +5, engage +3, find +3 → 74) assumed no groups move. Open decision.
  assert.deepEqual(r.moves.map((m) => [m.id, m.gain]), [['groups', 5], ['lists', 5], ['find', 3]]);
  assert.equal(r.after, 75);
});

test('Page visitors worked: bonus lever, only for Page admins', () => {
  const base = { invitations: { read: 10, under1w: 10, w2plus: 0 } };
  const none = computeGrade(base);
  assert.equal(none.levers.find((l) => l.id === 'pageVisitors').value, null, 'not a Page admin: left out');
  const r = computeGrade({ ...base, page: { visitors30d: 40 } });
  const pv = r.levers.find((l) => l.id === 'pageVisitors');
  assert.equal(pv.value, 100, '40 invitations a month for 40 visitors');
  assert.equal(pv.group, 'work');
  assert.equal(computeGrade({ invitations: { read: 5, under1w: 5, w2plus: 0 }, page: { visitors30d: 40 } }).levers.find((l) => l.id === 'pageVisitors').value, 50);
  assert.equal(computeGrade({ page: { visitors30d: 40 } }).levers.find((l) => l.id === 'pageVisitors').value, null, 'no invitations reading');
  assert.equal(computeGrade({ ...base, page: { visitors30d: 0 } }).levers.find((l) => l.id === 'pageVisitors').value, null, 'no visitors: nothing to work');
});
