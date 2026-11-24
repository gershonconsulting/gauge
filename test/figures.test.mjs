import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { signSession, gradeFor, cleanFigures } from '../site/_worker.js';

function fakeKV() {
  const m = new Map();
  return { m, get: async (k) => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, String(v)); }, delete: async (k) => { m.delete(k); },
    list: async ({ prefix = '' } = {}) => ({ keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }) };
}
const SECRET = 's';
const env0 = () => ({ LINKEDIN_CLIENT_SECRET: 'x', SESSION_SECRET: SECRET, GAUGE_KV: fakeKV() });
const tok = (sub, email) => signSession({ sub, name: 'N ' + sub, picture: '', email, exp: Math.floor(Date.now() / 1000) + 600 }, SECRET);
async function call(env, path, { sub, email, method = 'GET', body } = {}) {
  const h = { 'Content-Type': 'application/json' };
  if (sub) h.Cookie = 'gauge_session=' + (await tok(sub, email || sub + '@example.com'));
  return worker.fetch(new Request('https://gauge.gershon.ai' + path, { method, headers: h, body: body && JSON.stringify(body) }), env);
}
const ADMIN = { sub: 'o', email: 'Olivier@Attia.com' };
const FIG = {
  v: 1, readAt: new Date().toISOString(),
  ssi: { total: 63, brand: 15, find: 12, engage: 10, relationships: 20, industryTop: 4, networkTop: 2 },
  invitations: { pending: 484, read: 300, under1w: 40, w1: 60, w2plus: 200 },
  dashboard: { followers: 9000, profileViewers: 320, searchAppearances: 150 },
  content: { impressions: 12000, engagements: 240 },
  lists: { people: { lists: 12, updated30d: 3, items: 900, savedTotal: 1500, names: ['Secret list'] }, company: { lists: 4, updated30d: 1, items: 200 } },
  salesnav: { inmailLeft: 7, savedLeads: 1500, savedAccounts: 420 },
  groups: { joined: 48, loading: false }, page: { visitors30d: 800 },
  extra: { leak: 1 }, note: 'text',
};
const saveWith = (env, who, figures) => call(env, '/api/grade', { ...who, method: 'POST', body: { overall: 60, fill: 50, work: 70, grade: gradeFor(60), figures } });

test('cleanFigures keeps only numbers from known groups', () => {
  const c = cleanFigures(FIG);
  assert.equal(c.ssi.total, 63);
  assert.equal(c.salesnav.inmailLeft, 7);
  assert.equal(c.lists.people.savedTotal, 1500);
  assert.equal(c.lists.people.names, undefined);
  assert.equal(c.groups.loading, undefined);
  assert.equal(c.extra, undefined);
  assert.equal(c.v, undefined);
  assert.equal(cleanFigures('x'), null);
  assert.equal(cleanFigures([1]), null);
});

test('figures are NOT stored while the switch is off, even for an admin', async () => {
  const env = env0();
  const r = await (await saveWith(env, ADMIN, FIG)).json();
  assert.equal(r.saved, true);
  assert.equal(r.figuresSaved, false);
  assert.ok(![...env.GAUGE_KV.m.keys()].some((k) => /^(figures|fighist|feed):/.test(k)));
});

test('non-admins cannot switch it on and never get figures stored', async () => {
  const env = env0();
  const st = await (await call(env, '/api/settings', { sub: 'x' })).json();
  assert.equal(st.canSendFigures, false);
  assert.equal((await call(env, '/api/settings', { sub: 'x', method: 'POST', body: { sendFigures: true } })).status, 403);
  const r = await (await saveWith(env, { sub: 'x' }, FIG)).json();
  assert.equal(r.figuresSaved, false);
  assert.ok(![...env.GAUGE_KV.m.keys()].some((k) => /^(figures|fighist|feed):/.test(k)));
});

test('admin with the switch on: figures, history and feed saved; switching off deletes them', async () => {
  const env = env0();
  const on = await (await call(env, '/api/settings', { ...ADMIN, method: 'POST', body: { sendFigures: true } })).json();
  assert.equal(on.sendFigures, true);
  const r = await (await saveWith(env, ADMIN, FIG)).json();
  assert.equal(r.figuresSaved, true);
  const feed = JSON.parse(env.GAUGE_KV.m.get('feed:olivier@attia.com'));
  assert.equal(feed.memberId, 'o');
  assert.equal(feed.figures.ssi.total, 63);
  assert.equal(feed.figures.salesnav.inmailLeft, 7);
  assert.equal(feed.grade, gradeFor(60));
  assert.ok(!JSON.stringify(feed).includes('Secret list'));
  await saveWith(env, ADMIN, FIG);
  assert.equal(JSON.parse(env.GAUGE_KV.m.get('fighist:o')).length, 2);
  await call(env, '/api/settings', { ...ADMIN, method: 'POST', body: { sendFigures: false } });
  assert.ok(![...env.GAUGE_KV.m.keys()].some((k) => /^(figures|fighist|feed):/.test(k)));
});

test('delete-me removes the figures too', async () => {
  const env = env0();
  await call(env, '/api/settings', { ...ADMIN, method: 'POST', body: { sendFigures: true } });
  await saveWith(env, ADMIN, FIG);
  assert.ok(env.GAUGE_KV.m.has('feed:olivier@attia.com'));
  assert.equal((await call(env, '/api/delete-me', { ...ADMIN, method: 'POST' })).status, 200);
  assert.ok(![...env.GAUGE_KV.m.keys()].some((k) => /^(figures|fighist|feed):/.test(k)));
});
