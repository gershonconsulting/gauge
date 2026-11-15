import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (f) => readFileSync(new URL('../site/' + f, import.meta.url), 'utf8');

test('privacy policy carries what the Chrome Web Store requires', () => {
  const p = read('privacy.html');
  assert.ok(!/draft/i.test(p), 'must not be marked draft');
  for (const needle of [
    'Limited Use requirements', 'Chrome Web Store User Data Policy', 'does not sell',
    'Cloudflare', 'Grade me', 'HTTPS', 'delete', 'olivier@gershonconsulting.com',
    'not affiliated with', 'loads no code from the internet',
  ]) assert.ok(p.includes(needle), 'missing: ' + needle);
});

test('terms, support and landing page are linked and routed', () => {
  const routes = read('_redirects');
  for (const page of ['privacy', 'terms', 'support']) {
    assert.ok(routes.includes('/' + page + ' /' + page + '.html 200'));
    assert.ok(read('index.html').includes('href="/' + page + '"'));
    assert.ok(read(page + '.html').includes('href="/privacy"'));
  }
});
