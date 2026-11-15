import test from 'node:test';
import assert from 'node:assert/strict';
import { levelFor, isoWeek, weeklyStreak, personalBest, isPersonalBest, inviteBadges, compareVersions, extensionState } from '../site/game.js';
import { gradeFor as scoreGrade, fromLevers, computeGrade } from '../site/score.js';
import { gradeFor as workerGrade } from '../site/_worker.js';

test('levels follow the agreed bands', () => {
  const cases = [[0, 'Starter'], [39, 'Starter'], [40, 'Builder'], [54, 'Builder'], [55, 'Operator'], [69, 'Operator'], [70, 'Pro'], [84, 'Pro'], [85, 'Master'], [100, 'Master']];
  for (const [v, name] of cases) assert.equal(levelFor(v).name, name, String(v));
  assert.deepEqual(levelFor(66), { name: 'Operator', index: 2, next: 'Pro', toNext: 4 });
  assert.equal(levelFor(90).next, null);
  assert.equal(levelFor(null), null);
});

test('ISO weeks, including the year boundary', () => {
  assert.equal(isoWeek(new Date('2026-11-14T12:00:00Z')), '2026-W46');
  assert.equal(isoWeek(new Date('2027-01-01T12:00:00Z')), '2026-W53');
  assert.equal(isoWeek(new Date('2026-01-01T12:00:00Z')), '2026-W01');
});

test('weekly streak counts back from this week or last week', () => {
  const now = new Date('2026-11-14T12:00:00Z'); // Saturday, W46
  assert.equal(weeklyStreak([], now), 0);
  assert.equal(weeklyStreak(['2026-11-10', '2026-11-03', '2026-10-27'], now), 3);
  // nothing this week yet: the streak still counts from last week
  assert.equal(weeklyStreak(['2026-11-05', '2026-10-29'], now), 2);
  // a gap breaks it
  assert.equal(weeklyStreak(['2026-11-12', '2026-10-27'], now), 1);
  // two weeks without a test: streak over
  assert.equal(weeklyStreak(['2026-10-29'], now), 0);
  // several tests in one week count once
  assert.equal(weeklyStreak(['2026-11-09', '2026-11-10', '2026-11-11'], now), 1);
  assert.equal(weeklyStreak(['not a date'], now), 0);
});

test('personal best', () => {
  const items = [{ at: '2026-11-01', overall: 60 }, { at: '2026-11-07', overall: 70 }, { at: '2026-11-14', overall: 70 }];
  assert.deepEqual(personalBest(items), items[1]);
  assert.equal(personalBest([]), null);
  assert.equal(isPersonalBest({ overall: 71 }, items), true);
  assert.equal(isPersonalBest({ overall: 70 }, items), false);
  assert.equal(isPersonalBest({ overall: 10 }, []), true);
});

test('invite badges at 1, 5, 10 and 25 graded invitees', () => {
  assert.deepEqual(inviteBadges(0).map((b) => b.earned), [false, false, false, false]);
  assert.deepEqual(inviteBadges(1).map((b) => b.earned), [true, false, false, false]);
  assert.deepEqual(inviteBadges(9).map((b) => b.earned), [true, true, false, false]);
  assert.deepEqual(inviteBadges(25).map((b) => b.earned), [true, true, true, true]);
  assert.deepEqual(inviteBadges(25).map((b) => b.at), [1, 5, 10, 25]);
});

test('version comparison and extension state', () => {
  assert.equal(compareVersions('0.2.0', '0.2.0'), 0);
  assert.equal(compareVersions('0.1.9', '0.2.0'), -1);
  assert.equal(compareVersions('0.10.0', '0.9.9'), 1);
  assert.equal(compareVersions('1', '1.0.0'), 0);
  assert.equal(compareVersions('1.0.1', '1.0'), 1);
  assert.equal(compareVersions(undefined, '0.0.1'), -1);
  assert.equal(extensionState({ chromium: false, installed: null, latest: '0.2.0' }), 'unsupported');
  assert.equal(extensionState({ chromium: true, installed: null, latest: '0.2.0' }), 'missing');
  assert.equal(extensionState({ chromium: true, installed: '0.1.0', latest: '0.2.0' }), 'outdated');
  assert.equal(extensionState({ chromium: true, installed: '0.2.0', latest: '0.2.0' }), 'current');
});

test('worker and report agree on grade bands; saved levers rebuild the same result', () => {
  for (let v = 0; v <= 100; v++) assert.equal(workerGrade(v), scoreGrade(v), String(v));
  const r = computeGrade({ ssi: { find: 11.7, engage: 8.5 }, salesnav: { inmailLeft: 0, savedLeads: 7441, savedAccounts: 10000 },
    lists: { people: { lists: 16, updated30d: 2 }, company: { lists: 11, updated30d: 0 } }, invitations: { read: 484, under1w: 125, w2plus: 235 } });
  const saved = Object.fromEntries(r.levers.filter((l) => l.value != null).map((l) => [l.id, l.value]));
  const b = fromLevers(saved);
  assert.equal(b.overall, r.overall);
  assert.equal(b.fill, r.fill);
  assert.equal(b.work, r.work);
  assert.deepEqual(b.moves, r.moves);
});
