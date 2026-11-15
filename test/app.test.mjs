import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { signSession, percentile, attribute, gradeFor as grade, HISTORY_CAP, SAVES_PER_DAY } from '../site/_worker.js';

// In-memory stand-in for a Cloudflare KV namespace (get/put/delete/list with prefix).
function fakeKV() {
  const m = new Map();
  return {
    m,
    get: async (k) => (m.has(k) ? m.get(k) : null),
    put: async (k, v) => { m.set(k, String(v)); },
    delete: async (k) => { m.delete(k); },
    list: async ({ prefix = '' } = {}) => ({ keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
  };
}
const SECRET = 'test-session';
const base = { LINKEDIN_CLIENT_SECRET: 'x', SESSION_SECRET: SECRET, ASSETS: { fetch: async () => new Response('page', { headers: { 'Content-Type': 'text/html' } }) } };
const tok = (sub, name = 'Member ' + sub) => signSession({ sub, name, picture: `https://p/${sub}.jpg`, email: `${sub}@example.com`, exp: Math.floor(Date.now() / 1000) + 600 }, SECRET);
async function call(env, path, { sub, method = 'GET', body, cookie = '' } = {}) {
  const c = [cookie, sub ? 'gauge_session=' + (await tok(sub)) : ''].filter(Boolean).join('; ');
  return worker.fetch(new Request('https://gauge.gershon.ai' + path, {
    method, headers: { 'Content-Type': 'application/json', ...(c ? { Cookie: c } : {}) }, body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
}
const save = (env, sub, overall, extra = {}) => call(env, '/api/grade', { sub, method: 'POST', body: { overall, fill: 50, work: 50, grade: grade(overall), ...extra } });
const J = async (r) => r.json();

// Sign a member in through the real callback (LinkedIn mocked), optionally with a ref cookie.
async function signIn(env, sub, ref) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => (String(url).includes('accessToken') ? Response.json({ access_token: 't' })
    : Response.json({ sub, name: 'Member ' + sub, picture: `https://p/${sub}.jpg`, email: `${sub}@example.com` }));
  try {
    const cookie = 'gauge_oauth_state=s' + (ref ? '; gauge_ref=' + ref : '');
    return await worker.fetch(new Request('https://gauge.gershon.ai/api/auth/linkedin/callback?code=c&state=s', { headers: { Cookie: cookie } }), env);
  } finally { globalThis.fetch = real; }
}
const codeOf = async (env, sub) => (await J(await call(env, '/api/invite', { sub }))).code;

test('every app endpoint refuses signed-out calls with 401', async () => {
  const env = { ...base, GAUGE_KV: fakeKV() };
  for (const [p, method] of [['/api/history'], ['/api/settings'], ['/api/settings', 'POST'], ['/api/invite'], ['/api/compare'], ['/api/delete-me', 'POST'], ['/api/grade', 'POST']]) {
    const r = await call(env, p, { method: method || 'GET', body: method ? {} : undefined });
    assert.equal(r.status, 401, p + ' ' + (method || 'GET'));
  }
});

test('without KV every endpoint answers clearly instead of failing', async () => {
  const env = { ...base };
  assert.deepEqual(await J(await call(env, '/api/history', { sub: 'a' })), { storage: false, error: 'storage_not_configured', items: [] });
  assert.equal((await J(await call(env, '/api/settings', { sub: 'a' }))).showName, false);
  assert.equal((await call(env, '/api/settings', { sub: 'a', method: 'POST', body: { showName: true } })).status, 503);
  assert.equal((await J(await call(env, '/api/invite', { sub: 'a' }))).storage, false);
  assert.equal((await J(await call(env, '/api/compare', { sub: 'a' }))).storage, false);
  assert.equal((await J(await save(env, 'a', 66))).saved, false);
  const d = await call(env, '/api/delete-me', { sub: 'a', method: 'POST' });
  assert.equal(d.status, 200);
  assert.ok(d.headers.get('Set-Cookie').includes('gauge_session=;'));
  assert.equal((await signIn(env, 'a')).status, 302); // sign-in still works
});

test('a test accepts only scores 0–100, a matching grade and a recent date', async () => {
  const env = { ...base, GAUGE_KV: fakeKV() };
  for (const bad of [{ overall: 101, grade: 'A' }, { overall: -1, grade: 'F' }, { overall: 66.5, grade: 'C+' }, { overall: '66', grade: 'C+' }, { overall: 66, grade: 'A' }, { overall: 66 }]) {
    assert.equal((await call(env, '/api/grade', { sub: 'a', method: 'POST', body: bad })).status, 400, JSON.stringify(bad));
  }
  const bad = await worker.fetch(new Request('https://gauge.gershon.ai/api/grade', { method: 'POST', headers: { Cookie: 'gauge_session=' + (await tok('a')) }, body: 'nope' }), env);
  assert.equal(bad.status, 400);
  await save(env, 'a', 66, { fill: 500, work: 'x', levers: { lists: 7, inmail: 300, evil: 5 }, names: ['Lead'], raw: 'page text', at: '1999-01-01' });
  const h = (await J(await call(env, '/api/history', { sub: 'a' }))).items;
  assert.equal(h.length, 1);
  assert.deepEqual(Object.keys(h[0]).sort(), ['at', 'fill', 'grade', 'levers', 'overall', 'work']);
  assert.deepEqual(h[0].levers, { lists: 7 });
  assert.equal(h[0].fill, null);
  assert.equal(h[0].work, null);
  assert.ok(Date.now() - Date.parse(h[0].at) < 60000, 'old client dates are replaced by now');
  assert.ok(![...env.GAUGE_KV.m.values()].some((v) => v.includes('page text') || v.includes('Lead')));
  const recent = new Date(Date.now() - 86400000).toISOString();
  await save(env, 'a', 70, { at: recent });
  assert.ok((await J(await call(env, '/api/history', { sub: 'a' }))).items.some((x) => x.at === recent));
});

test('history is newest first and capped at 100; latest:<id> keeps working', async () => {
  const kv = fakeKV();
  const env = { ...base, GAUGE_KV: kv };
  const old = Array.from({ length: HISTORY_CAP }, (_, i) => ({ at: new Date(Date.UTC(2025, 0, 1 + i)).toISOString(), overall: 10, fill: 10, work: 10, grade: 'F', levers: {} }));
  await kv.put('hist:a', JSON.stringify(old));
  const r = await J(await save(env, 'a', 66));
  assert.equal(r.saved, true);
  const items = (await J(await call(env, '/api/history', { sub: 'a' }))).items;
  assert.equal(items.length, HISTORY_CAP);
  assert.equal(items[0].overall, 66);
  assert.ok(!items.some((x) => x.at === old[0].at), 'oldest test dropped');
  assert.equal(JSON.parse(await kv.get('latest:a')).overall, 66);
});

test('personal best flag and per-member daily rate limit', async () => {
  const env = { ...base, GAUGE_KV: fakeKV() };
  assert.equal((await J(await save(env, 'a', 50))).personalBest, true);
  assert.equal((await J(await save(env, 'a', 40))).personalBest, false);
  assert.equal((await J(await save(env, 'a', 60))).personalBest, true);
  for (let i = 3; i < SAVES_PER_DAY; i++) assert.equal((await save(env, 'a', 50)).status, 200);
  assert.equal((await save(env, 'a', 50)).status, 429);
  assert.equal((await save(env, 'b', 50)).status, 200, 'other members are not limited');
});

test('settings: show-name is OFF by default and only accepts a boolean', async () => {
  const env = { ...base, GAUGE_KV: fakeKV() };
  assert.equal((await J(await call(env, '/api/settings', { sub: 'a' }))).showName, false);
  await signIn(env, 'a');
  assert.equal((await J(await call(env, '/api/settings', { sub: 'a' }))).showName, false);
  assert.equal((await call(env, '/api/settings', { sub: 'a', method: 'POST', body: { showName: 'yes' } })).status, 400);
  assert.equal((await J(await call(env, '/api/settings', { sub: 'a', method: 'POST', body: { showName: true } }))).showName, true);
  assert.equal((await J(await call(env, '/api/settings', { sub: 'a' }))).showName, true);
});

test('landing page stores the ref code once (first inviter wins)', async () => {
  const env = { ...base, GAUGE_KV: fakeKV() };
  const r = await call(env, '/?ref=abcd2345');
  const c = r.headers.get('Set-Cookie');
  assert.ok(c.startsWith('gauge_ref=abcd2345;') && c.includes('Secure') && c.includes('SameSite=Lax') && c.includes(`Max-Age=${60 * 60 * 24 * 30}`));
  assert.equal(await r.text(), 'page');
  assert.equal((await call(env, '/?ref=zzzz2345', { cookie: 'gauge_ref=abcd2345' })).headers.get('Set-Cookie'), null);
  assert.equal((await call(env, '/?ref=<script>')).headers.get('Set-Cookie'), null);
});

test('ref attribution: new users only, once, no self-referral, inviter must exist', async () => {
  const env = { ...base, GAUGE_KV: fakeKV() };
  await signIn(env, 'inv');
  const code = await codeOf(env, 'inv');
  assert.match(code, /^[a-z2-9]{8}$/);
  const res = await signIn(env, 'new1', code);
  assert.ok(res.headers.getSetCookie().some((c) => c.startsWith('gauge_ref=;')), 'ref cookie cleared after sign-in');
  assert.equal(JSON.parse(await env.GAUGE_KV.get('member:new1')).invitedBy, 'inv');
  // signing in again with another inviter's code never changes it
  await signIn(env, 'other');
  await signIn(env, 'new1', await codeOf(env, 'other'));
  assert.equal(JSON.parse(await env.GAUGE_KV.get('member:new1')).invitedBy, 'inv');
  // an existing member is not attributed later
  await signIn(env, 'old');
  await signIn(env, 'old', code);
  assert.equal(JSON.parse(await env.GAUGE_KV.get('member:old')).invitedBy, null);
  // self-referral and unknown codes are ignored
  const self = JSON.parse(await env.GAUGE_KV.get('member:inv'));
  assert.equal(await attribute(env.GAUGE_KV, { ...self, invitedBy: null }, self.code), false);
  await signIn(env, 'new2', 'zzzz9999');
  assert.equal(JSON.parse(await env.GAUGE_KV.get('member:new2')).invitedBy, null);
  // counts: signed in, then graded
  let i = await J(await call(env, '/api/invite', { sub: 'inv' }));
  assert.deepEqual([i.signedIn, i.graded, i.link], [1, 0, `https://gauge.gershon.ai/?ref=${code}`]);
  await save(env, 'new1', 60);
  await save(env, 'new1', 62);
  i = await J(await call(env, '/api/invite', { sub: 'inv' }));
  assert.deepEqual([i.signedIn, i.graded], [1, 1]);
});

test('leaderboard hides names without opt-in, never shows emails, ranks and moves', async () => {
  const env = { ...base, GAUGE_KV: fakeKV() };
  await signIn(env, 'me');
  const code = await codeOf(env, 'me');
  await signIn(env, 'p1', code);
  await signIn(env, 'p2', code);
  await signIn(env, 'p3', code); // signed in, no test yet
  await save(env, 'me', 60);
  await save(env, 'p1', 70);
  await save(env, 'p2', 50);
  await save(env, 'p2', 80); // p2 jumps from last to first
  await call(env, '/api/settings', { sub: 'p1', method: 'POST', body: { showName: true } });
  const r = await J(await call(env, '/api/compare', { sub: 'me' }));
  assert.ok(!JSON.stringify(r).includes('@example.com'));
  assert.deepEqual(r.circle.map((x) => [x.rank, x.overall, x.name]), [[1, 80, 'Anonymous member'], [2, 70, 'Member p1'], [3, 60, 'Anonymous member']]);
  assert.equal(r.circle[0].picture, '');
  assert.equal(r.circle[1].picture, 'https://p/p1.jpg');
  assert.equal(r.circle[2].you, true);
  assert.equal(r.circle[0].movement, 2);
  assert.equal(r.circle[0].change, 30);
  assert.equal(r.circle[1].movement, null);
  assert.equal(r.pendingInCircle, 1);
  // the invitee sees whoever invited them
  const p2 = await J(await call(env, '/api/compare', { sub: 'p2' }));
  assert.ok(p2.circle.some((x) => x.invitedYou && x.overall === 60));
  assert.equal(p2.circle.length, 2);
});

test('percentile stays locked under 20 users and is computed from the histogram', async () => {
  const env = { ...base, GAUGE_KV: fakeKV() };
  for (let i = 0; i < 19; i++) await save(env, 'u' + i, i * 5);
  let r = await J(await call(env, '/api/compare', { sub: 'u10' }));
  assert.deepEqual(r.global, { users: 19, minUsers: 20, percentile: null });
  await save(env, 'u19', 99);
  r = await J(await call(env, '/api/compare', { sub: 'u10' }));
  assert.equal(r.global.users, 20);
  assert.equal(r.global.percentile, Math.round((100 * 10) / 19));
  // re-testing moves a member between buckets without counting them twice
  await save(env, 'u10', 100);
  r = await J(await call(env, '/api/compare', { sub: 'u10' }));
  assert.equal(r.global.users, 20);
  assert.equal(r.global.percentile, 100);
  assert.equal(percentile({ users: 5, hist: [5] }, 0), null);
  assert.equal(percentile({ users: 20, hist: [20] }, 0), 50);
});

test('delete my data removes every record of the member and signs out', async () => {
  const kv = fakeKV();
  const env = { ...base, GAUGE_KV: kv };
  await signIn(env, 'up');
  await signIn(env, 'me', await codeOf(env, 'up'));
  await signIn(env, 'down', await codeOf(env, 'me'));
  await save(env, 'me', 66);
  await save(env, 'down', 50);
  await call(env, '/api/settings', { sub: 'me', method: 'POST', body: { showName: true } });
  await kv.put('grade:me:2026-11-01T00:00:00Z', '{}'); // legacy per-test record from the first release
  const code = JSON.parse(await kv.get('member:me')).code;
  assert.equal((await call(env, '/api/delete-me', { sub: 'me' })).status, 405);
  const res = await call(env, '/api/delete-me', { sub: 'me', method: 'POST' });
  assert.equal(res.status, 200);
  assert.ok(res.headers.get('Set-Cookie').startsWith('gauge_session=;'));
  for (const [k, v] of kv.m) {
    assert.ok(!v.includes('"me"') && !v.includes('me@example.com'), 'value still mentions member: ' + k + ' ' + v);
  }
  assert.ok(![...kv.m.keys()].some((k) => /(^|:)me(:|$)/.test(k)), 'no key for the member');
  assert.equal(await kv.get('ref:' + code), null);
  assert.deepEqual(JSON.parse(await kv.get('invites:up')), { signedIn: [], graded: [] });
  assert.equal(JSON.parse(await kv.get('member:down')).invitedBy, null);
  assert.equal(JSON.parse(await kv.get('stats:global')).users, 1);
});
