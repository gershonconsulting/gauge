import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker, { APP_VERSION } from '../site/_worker.js';

test('/api/health reports the app version, equal to the extension manifest version', async () => {
  const env = { LINKEDIN_CLIENT_SECRET: 'x', ASSETS: { fetch: async () => new Response('asset') } };
  const h = await (await worker.fetch(new Request('https://gauge.gershon.ai/api/health'), env)).json();
  const m = JSON.parse(readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
  assert.equal(h.version, APP_VERSION);
  assert.equal(h.version, m.version);
});
