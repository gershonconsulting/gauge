import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { signSession, summarize, reportEmail, gradeFor } from '../site/_worker.js';

function fakeKV() {
  const m = new Map();
  return { m, get: async (k) => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, String(v)); }, delete: async (k) => { m.delete(k); },
    list: async ({ prefix = '' } = {}) => ({ keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }) };
}
const SECRET = 's';
const page = { fetch: async (req) => new Response('admin page ' + new URL(req.url).pathname, { headers: { 'Content-Type': 'text/html' } }) };
const env0 = () => ({ LINKEDIN_CLIENT_SECRET: 'x', SESSION_SECRET: SECRET, ASSETS: page, GAUGE_KV: fakeKV() });
const tok = (sub, email) => signSession({ sub, name: 'N ' + sub, picture: '', email, exp: Math.floor(Date.now() / 1000) + 600 }, SECRET);
async function call(env, path, { sub, email, method = 'GET', body } = {}) {
  const h = { 'Content-Type': 'application/json' };
  if (sub) h.Cookie = 'gauge_session=' + (await tok(sub, email || sub + '@example.com'));
  return worker.fetch(new Request('https://gauge.gershon.ai' + path, { method, headers: h, body: body && JSON.stringify(body) }), env);
}
const ADMIN = { sub: 'o', email: 'Olivier@GershonConsulting.com' };
const save = (env, sub, overall) => call(env, '/api/grade', { sub, method: 'POST', body: { overall, fill: 50, work: 50, grade: gradeFor(overall) } });

test('/admin: signed out → LinkedIn sign-in back to /admin; non-admin → 403; admin → page', async () => {
  const env = env0();
  for (const p of ['/admin', '/admin.html']) {
    const r = await call(env, p);
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('Location'), '/api/auth/linkedin/start?next=/admin');
    assert.equal((await call(env, p, { sub: 'x' })).status, 403);
  }
  const ok = await call(env, '/admin', ADMIN);
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), 'admin page /admin');
  assert.equal((await call({ ...env, ADMIN_EMAILS: 'aina@gershonconsulting.com' }, '/admin', { sub: 'a', email: 'aina@gershonconsulting.com' })).status, 200);
});

test('admin APIs refuse non-admins', async () => {
  const env = env0();
  assert.equal((await call(env, '/api/admin/summary')).status, 401);
  assert.equal((await call(env, '/api/admin/summary', { sub: 'x' })).status, 403);
  assert.equal((await call(env, '/api/admin/member?id=x', { sub: 'x' })).status, 403);
});

test('names and scores only for members who opted in; others only counted', async () => {
  const env = env0();
  await save(env, 'a', 80);
  await save(env, 'b', 30);
  await call(env, '/api/settings', { sub: 'a', method: 'POST', body: { shareWithGershon: true } });
  const s = await (await call(env, '/api/admin/summary', ADMIN)).json();
  assert.equal(s.totals.signedIn, 2);
  assert.equal(s.totals.graded, 2);
  assert.equal(s.totals.average, 55);
  assert.equal(s.totals.shared, 1);
  assert.deepEqual(s.people.map((p) => p.email), ['a@example.com']);
  assert.ok(!JSON.stringify(s).includes('b@example.com'));
  assert.equal((await call(env, '/api/admin/member?id=b', ADMIN)).status, 404);
  const d = await (await call(env, '/api/admin/member?id=a', ADMIN)).json();
  assert.equal(d.history.length, 1);
  // withdrawing consent removes them again
  await call(env, '/api/settings', { sub: 'a', method: 'POST', body: { shareWithGershon: false } });
  assert.equal((await (await call(env, '/api/admin/summary', ADMIN)).json()).people.length, 0);
  // the showName setting keeps working on its own
  const r = await (await call(env, '/api/settings', { sub: 'a', method: 'POST', body: { showName: true } })).json();
  assert.deepEqual(r, { storage: true, showName: true, shareWithGershon: false });
});

test('daily report: once per 20 h, fixed recipient, Resend called, admin force/preview', async () => {
  const env = { ...env0(), RESEND_API_KEY: 'k' };
  await save(env, 'a', 80);
  await call(env, '/api/settings', { sub: 'a', method: 'POST', body: { shareWithGershon: true } });
  const sent = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sent.push([String(url), JSON.parse(init.body)]); return Response.json({ id: '1' }); };
  try {
    assert.equal((await call(env, '/api/admin/daily')).status, 405);
    const first = await (await call(env, '/api/admin/daily', { method: 'POST' })).json();
    assert.equal(first.sent, true);
    assert.equal(sent[0][0], 'https://api.resend.com/emails');
    assert.deepEqual(sent[0][1].to, ['report@gershonconsulting.com']);
    assert.match(sent[0][1].subject, /^Gauge Report — /);
    assert.ok(sent[0][1].html.includes('a@example.com'));
    assert.equal((await (await call(env, '/api/admin/daily', { method: 'POST' })).json()).skipped, 'already_sent');
    assert.equal((await (await call(env, '/api/admin/daily?force=1', { method: 'POST', sub: 'x' })).json()).skipped, 'already_sent');
    const pv = await (await call(env, '/api/admin/daily?preview=1', { method: 'POST', ...ADMIN })).json();
    assert.equal(pv.preview, true);
    assert.equal(sent.length, 1);
    assert.equal((await (await call(env, '/api/admin/daily?force=1', { method: 'POST', ...ADMIN })).json()).sent, true);
    assert.equal(sent.length, 2);
  } finally { globalThis.fetch = real; }
});

test('daily report without an email key answers clearly', async () => {
  const env = env0();
  const r = await (await call(env, '/api/admin/daily', { method: 'POST' })).json();
  assert.equal(r.error, 'email_not_configured');
});

test('report email never names a member who did not share', () => {
  const now = Date.now();
  const members = [
    { id: 'a', name: 'Ann', email: 'ann@x.com', shareWithGershon: true, lastOverall: 70, tests: 1, lastAt: new Date(now).toISOString(), createdAt: new Date(now).toISOString() },
    { id: 'b', name: 'Bob', email: 'bob@x.com', lastOverall: 40, tests: 2, lastAt: new Date(now).toISOString(), createdAt: new Date(now).toISOString() },
  ];
  const mail = reportEmail(summarize(members, now - 86400000), now - 86400000, now);
  assert.ok(mail.html.includes('ann@x.com'));
  assert.ok(!mail.html.includes('Bob') && !mail.html.includes('bob@x.com'));
  assert.ok(mail.html.includes('1 other tester'));
});
