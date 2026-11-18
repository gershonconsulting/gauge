import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { bumpCampaign, campaigns, reportEmail } from '../site/_worker.js';

function fakeKv() {
  const m = new Map();
  return {
    m,
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
    async list({ prefix }) { return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; },
  };
}
const assets = { fetch: async () => new Response('<html>home</html>', { headers: { 'Content-Type': 'text/html' } }) };

test('landing with ?src= sets the campaign cookie once and counts one visit', async () => {
  const kv = fakeKv();
  const env = { GAUGE_KV: kv, ASSETS: assets };
  const r = await worker.fetch(new Request('https://gauge.gershon.ai/?src=Spotlight'), env);
  assert.match(r.headers.get('Set-Cookie') || '', /gauge_src=spotlight;.*HttpOnly/);
  const again = await worker.fetch(new Request('https://gauge.gershon.ai/?src=spotlight', { headers: { Cookie: 'gauge_src=spotlight' } }), env);
  assert.equal(again.headers.get('Set-Cookie'), null, 'returning visitor: no new cookie, no new visit');
  await worker.fetch(new Request('https://gauge.gershon.ai/?src=bad%20name!'), env);
  const rows = await campaigns(kv);
  assert.deepEqual(rows.map((c) => [c.src, c.visit]), [['spotlight', 1]]);
});

test('report event counts only for campaign visitors, only the report type', async () => {
  const kv = fakeKv();
  const env = { GAUGE_KV: kv, ASSETS: assets };
  const post = (body, cookie) => worker.fetch(new Request('https://gauge.gershon.ai/api/event', { method: 'POST', body: JSON.stringify(body), headers: cookie ? { Cookie: cookie } : {} }), env).then((r) => r.json());
  assert.deepEqual(await post({ type: 'report' }), { counted: false });
  assert.deepEqual(await post({ type: 'report' }, 'gauge_src=spotlight'), { counted: true });
  assert.equal((await post({ type: 'visit' }, 'gauge_src=spotlight')).error, 'bad_request');
  assert.equal((await campaigns(kv))[0].report, 1);
});

test('campaign counters and the daily email table', async () => {
  const kv = fakeKv();
  for (const t of ['visit', 'visit', 'report', 'signin', 'saved']) await bumpCampaign(kv, 'spotlight', t);
  assert.equal(await bumpCampaign(kv, 'spotlight', 'nope'), false);
  const [c] = await campaigns(kv);
  assert.deepEqual([c.visit, c.report, c.signin, c.saved], [2, 1, 1, 1]);
  const sum = { totals: { signedIn: 0, graded: 0, tests: 0, average: null, grades: { A: 0, B: 0, C: 0, D: 0, F: 0 }, invited: 0, shared: 0 }, recent: { signedIn: 0, tested: 0, average: null }, people: [] };
  const mail = reportEmail(sum, Date.now() - 86400000, Date.now(), [c]);
  assert.ok(mail.html.includes('Campaign links') && mail.html.includes('spotlight'));
  assert.ok(!reportEmail(sum, Date.now() - 86400000, Date.now()).html.includes('Campaign links'));
});
