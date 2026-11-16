import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

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
  // Cloudflare Pages serves /privacy from privacy.html on its own. A _redirects rewrite to
  // the .html file loops (308 back to /privacy), so the site must not ship one.
  assert.ok(!existsSync(new URL('../site/_redirects', import.meta.url)), '_redirects must not exist');
  for (const page of ['privacy', 'terms', 'support']) {
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

test('every page has a browser-tab icon and the icon files ship', () => {
  for (const f of readdirSync(new URL('../site/', import.meta.url)).filter((x) => x.endsWith('.html'))) {
    const h = read(f);
    assert.ok(h.includes('href="/favicon.ico"'), f + ': favicon.ico link missing');
    assert.ok(h.includes('href="/apple-touch-icon.png"'), f + ': apple-touch-icon link missing');
  }
  for (const f of ['favicon.ico', 'favicon-32.png', 'apple-touch-icon.png', 'icon-192.png']) {
    const b = readFileSync(new URL('../site/' + f, import.meta.url));
    assert.ok(b.length > 200, f + ' missing or empty');
  }
});

test('signed-in app shows the big "download the extension" call on every page when it is missing', () => {
  const a = read('app.js');
  assert.ok(a.includes('Download the Gauge Chrome extension now'));
  assert.ok(a.includes("if (signedIn && page !== 'extension') extBanner()"));
});
