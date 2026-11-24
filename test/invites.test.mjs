import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { cleanInvites, signSession, gradeFor } from '../site/_worker.js';
import { weeklyInvites } from '../site/game.js';

test('cleanInvites keeps integer counts only and needs the week figure', () => {
  assert.deepEqual(cleanInvites({ week: 129, prevWeek: 4, pending: 484, name: 'x' }), { week: 129, prevWeek: 4, pending: 484 });
  assert.equal(cleanInvites({ prevWeek: 4 }), null);
  assert.equal(cleanInvites({ week: -1 }), null);
  assert.equal(cleanInvites({ week: 1.5 }), null);
  assert.equal(cleanInvites('129'), null);
  assert.deepEqual(cleanInvites({ week: 3, pending: '9' }), { week: 3 });
});

test('weeklyInvites: one row per week, latest sync wins, prevWeek fills a missing week', () => {
  const items = [
    { at: '2026-11-24T15:00:00Z', inv: { week: 129, prevWeek: 20, pending: 484 } },
    { at: '2026-11-23T10:00:00Z', inv: { week: 90, prevWeek: 10, pending: 400 } }, // same ISO week as Nov 24 — loses
    { at: '2026-11-03T10:00:00Z', inv: { week: 60, prevWeek: 30 } },
    { at: '2026-11-02T10:00:00Z' }, // no counts
  ];
  const { rows, avg } = weeklyInvites(items);
  assert.deepEqual(rows.map((r) => [r.count, r.from]), [[129, 'sync'], [20, 'next'], [60, 'sync'], [30, 'next']]);
  assert.equal(rows[0].pending, 484);
  assert.equal(avg, Math.round((129 + 20 + 60 + 30) / 4));
  assert.deepEqual(weeklyInvites([]), { rows: [], avg: null });
});

test('/api/grade stores weekly invitation counts with the test and /api/history returns them', async () => {
  const m = new Map();
  const kv = { get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, String(v)); }, delete: async (k) => { m.delete(k); }, list: async () => ({ keys: [], list_complete: true }) };
  const env = { LINKEDIN_CLIENT_SECRET: 'x', SESSION_SECRET: 's', GAUGE_KV: kv, ASSETS: { fetch: async () => new Response('') } };
  const cookie = 'gauge_session=' + (await signSession({ sub: 'u1', name: 'U', email: 'u@e.com', exp: Math.floor(Date.now() / 1000) + 600 }, 's'));
  const req = (path, body) => worker.fetch(new Request('https://gauge.gershon.ai' + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body && JSON.stringify(body) }), env);
  const r = await req('/api/grade', { overall: 63, fill: 80, work: 40, grade: gradeFor(63), invites: { week: 129, prevWeek: 4, pending: 484, junk: 'x' } });
  assert.equal((await r.json()).saved, true);
  const h = await (await req('/api/history')).json();
  assert.deepEqual(h.items[0].inv, { week: 129, prevWeek: 4, pending: 484 });
});
