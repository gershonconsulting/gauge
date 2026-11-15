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
  assert.equal(r.notRead.length, 5);
  assert.equal(computeGrade({}).overall, null);
});

test('grade bands', () => {
  assert.deepEqual([90, 85, 80, 70, 66, 55, 40, 39].map(gradeFor), ['A', 'A', 'B+', 'B', 'C+', 'C', 'D', 'F']);
});

test('signals survive the URL fragment round trip', () => {
  assert.deepEqual(decodeSignals(encodeSignals(olivier)), olivier);
  assert.equal(decodeSignals('%%%'), null);
});
