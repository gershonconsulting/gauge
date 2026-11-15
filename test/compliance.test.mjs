import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

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

test('every HTML page links to the privacy policy and the terms', () => {
  const pages = readdirSync(new URL('../site/', import.meta.url)).filter((f) => f.endsWith('.html'));
  assert.ok(pages.length >= 6);
  for (const f of pages) {
    const html = read(f);
    assert.ok(html.includes('href="/privacy"'), f + ' must link /privacy');
    assert.ok(html.includes('href="/terms"'), f + ' must link /terms');
  }
  const app = read('app.js');
  assert.ok(app.includes("['/privacy', 'Privacy policy']") && app.includes("['/terms', 'Terms']"), 'Extension and Settings pages carry the legal links');
});
