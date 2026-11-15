import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const manifest = JSON.parse(read('extension/manifest.json'));
const latest = JSON.parse(read('site/extension-latest.json'));

test('site/extension-latest.json matches the extension manifest (run tools/build-extension.mjs)', () => {
  assert.equal(latest.version, manifest.version);
  assert.ok(latest.minVersion && latest.publishedAt && 'storeUrl' in latest);
  assert.equal(latest.download, `/downloads/gauge-extension-${manifest.version}.zip`);
});

test('the zip listed in latest.json exists on the site and in dist/', () => {
  assert.ok(existsSync(new URL('../site' + latest.download, import.meta.url)), 'site' + latest.download);
  assert.ok(existsSync(new URL(`../dist/gauge-extension-${manifest.version}.zip`, import.meta.url)));
  const zip = readFileSync(new URL('../site' + latest.download, import.meta.url));
  assert.ok(zip.includes(Buffer.from('manifest.json')) && zip.includes(Buffer.from('site-flag.js')));
});

test('extension reaches only www.linkedin.com and gauge.gershon.ai', () => {
  const hosts = [...manifest.host_permissions, ...(manifest.content_scripts || []).flatMap((c) => c.matches)];
  assert.deepEqual([...new Set(hosts)].sort(), ['https://gauge.gershon.ai/*', 'https://www.linkedin.com/*']);
  assert.ok(!/<all_urls>|\*:\/\/\*\/|https:\/\/\*\//.test(JSON.stringify(manifest)));
});

test('store pack and privacy policy mention the Gauge site content script', () => {
  assert.ok(read('store/SUBMISSION.md').includes('gauge.gershon.ai/*'));
  assert.ok(read('store/SUBMISSION.md').includes(`gauge-extension-${manifest.version}.zip`));
  assert.ok(read('site/privacy.html').includes('version number'));
});
