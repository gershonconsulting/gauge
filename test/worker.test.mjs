import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { signSession, readSession } from '../site/_worker.js';

const env = { LINKEDIN_CLIENT_SECRET: 'test-secret', SESSION_SECRET: 'test-session', ASSETS: { fetch: async () => new Response('asset') } };
const get = (path, headers = {}, e = env, method = 'GET') => worker.fetch(new Request('https://gauge.gershon.ai' + path, { headers, method }), e);
const cookieOf = (res, name) => res.headers.getSetCookie().find((c) => c.startsWith(name + '='))?.split(';')[0].split('=').slice(1).join('=');

test('start redirects to LinkedIn with sign-in scopes only', async () => {
  const res = await get('/api/auth/linkedin/start');
  assert.equal(res.status, 302);
  const u = new URL(res.headers.get('Location'));
  assert.equal(u.origin + u.pathname, 'https://www.linkedin.com/oauth/v2/authorization');
  assert.equal(u.searchParams.get('redirect_uri'), 'https://gauge.gershon.ai/api/auth/linkedin/callback');
  assert.equal(u.searchParams.get('scope'), 'openid profile email');
  assert.equal(u.searchParams.get('state'), cookieOf(res, 'gauge_oauth_state'));
});

test('session key is derived when only the LinkedIn secret is set', async () => {
  const e = { LINKEDIN_CLIENT_SECRET: 'only-this', ASSETS: env.ASSETS };
  assert.equal((await get('/api/auth/linkedin/start', {}, e)).status, 302);
  const h = await (await get('/api/health', {}, e)).json();
  assert.equal(h.sessionKeyReady, true);
});

test('start without secrets reports not_configured', async () => {
  const res = await get('/api/auth/linkedin/start', {}, { ASSETS: env.ASSETS });
  assert.equal(res.headers.get('Location'), '/?error=not_configured');
});

test('callback rejects a wrong state', async () => {
  const res = await get('/api/auth/linkedin/callback?code=x&state=a', { Cookie: 'gauge_oauth_state=b' });
  assert.equal(res.headers.get('Location'), '/?error=state_mismatch');
});

test('full sign-in sets a session that /api/me accepts', async () => {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push([String(url), init]);
    if (String(url).includes('accessToken')) return Response.json({ access_token: 'tok' });
    return Response.json({ sub: 'abc', name: 'Ada Lovelace', picture: 'https://p/x.jpg', email: 'ada@example.com' });
  };
  try {
    const res = await get('/api/auth/linkedin/callback?code=c1&state=s1', { Cookie: 'gauge_oauth_state=s1' });
    assert.equal(res.headers.get('Location'), '/');
    assert.equal(calls[0][1].body.get('client_secret'), 'test-secret');
    assert.equal(calls[1][1].headers.Authorization, 'Bearer tok');
    const session = cookieOf(res, 'gauge_session');
    assert.ok(!session.includes('tok'));
    const me = await get('/api/me', { Cookie: 'gauge_session=' + session });
    assert.deepEqual(await me.json(), { signedIn: true, name: 'Ada Lovelace', picture: 'https://p/x.jpg', email: 'ada@example.com' });
  } finally { globalThis.fetch = real; }
});

test('token exchange failure is reported', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response('no', { status: 400 });
  try {
    const res = await get('/api/auth/linkedin/callback?code=c1&state=s1', { Cookie: 'gauge_oauth_state=s1' });
    assert.equal(res.headers.get('Location'), '/?error=token_exchange_failed');
  } finally { globalThis.fetch = real; }
});

test('tampered, expired and missing sessions are refused', async () => {
  const good = await signSession({ sub: 'a', exp: Math.floor(Date.now() / 1000) + 60 }, 'k');
  assert.ok(await readSession(good, 'k'));
  assert.equal(await readSession(good, 'other'), null);
  assert.equal(await readSession(good.replace(/^./, 'X'), 'k'), null);
  assert.equal(await readSession(await signSession({ sub: 'a', exp: 1 }, 'k'), 'k'), null);
  assert.equal((await get('/api/me')).status, 401);
});

test('health exposes flags, never values; logout is POST only; assets fall through', async () => {
  const h = await (await get('/api/health')).text();
  assert.ok(!h.includes('test-secret') && h.includes('"linkedinSecretSet":true'));
  assert.equal((await get('/api/auth/logout')).status, 405);
  assert.equal((await get('/api/auth/logout', {}, env, 'POST')).status, 200);
  assert.equal(await (await get('/')).text(), 'asset');
  assert.equal((await get('/api/nope')).status, 404);
});

test('sign-in can return to the report, and only to allowed pages', async () => {
  const ok = await get('/api/auth/linkedin/start?next=/report');
  assert.equal(cookieOf(ok, 'gauge_next'), '/report');
  const bad = await get('/api/auth/linkedin/start?next=https://evil.example');
  assert.equal(cookieOf(bad, 'gauge_next'), undefined);
});

test('/api/grade stores scores only, for a signed-in user', async () => {
  const store = new Map();
  const e = { ...env, GAUGE_KV: { get: async (k) => store.get(k) ?? null, put: async (k, v) => store.set(k, v) } };
  const post = (body, cookie) => worker.fetch(new Request('https://gauge.gershon.ai/api/grade', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body),
  }), e);
  assert.equal((await post({ overall: 66, grade: 'C+' })).status, 401);
  const token = await signSession({ sub: 'abc', name: 'Test', email: 't@x.com', exp: Math.floor(Date.now() / 1000) + 60 }, 'test-session');
  const c = 'gauge_session=' + token;
  assert.equal((await post({ overall: 900, grade: 'C' }, c)).status, 400);
  const res = await post({ overall: 66, fill: 94, work: 29, grade: 'C+', levers: { lists: 7, evil: 5 }, raw: 'x' }, c);
  assert.equal((await res.json()).saved, true);
  const rec = JSON.parse(store.get('latest:abc'));
  assert.deepEqual(Object.keys(rec).sort(), ['at', 'email', 'fill', 'grade', 'levers', 'memberId', 'name', 'overall', 'work']);
  assert.deepEqual(rec.levers, { lists: 7 });
});
