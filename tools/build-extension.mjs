// Build the Gauge extension package and publish it to the site.
//   node tools/build-extension.mjs
// 1. zips extension/ into dist/gauge-extension-<version>.zip (older zips in dist/ are removed)
// 2. copies it to site/downloads/ (served at https://gauge.gershon.ai/downloads/…)
// 3. writes site/extension-latest.json, the site's single source of truth for the latest version
//    (keeps the existing minVersion and storeUrl; storeUrl stays empty until the store listing is live).
// Needs the `zip` command (Info-ZIP). Run it whenever extension/ changes, after bumping manifest "version".
import { readFileSync, writeFileSync, readdirSync, rmSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ext = join(root, 'extension');
const version = JSON.parse(readFileSync(join(ext, 'manifest.json'), 'utf8')).version;
const name = `gauge-extension-${version}.zip`;

const files = [];
(function walk(dir, rel) {
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name.startsWith('.')) continue;
    if (e.isDirectory()) walk(join(dir, e.name), rel + e.name + '/');
    else files.push(rel + e.name);
  }
})(ext, '');

for (const d of ['dist', 'site/downloads']) {
  mkdirSync(join(root, d), { recursive: true });
  for (const f of readdirSync(join(root, d))) if (/^gauge-extension-.*\.zip$/.test(f)) rmSync(join(root, d, f));
}
const out = join(root, 'dist', name);
execFileSync('zip', ['-X', '-q', out, ...files], { cwd: ext });
copyFileSync(out, join(root, 'site', 'downloads', name));

const latestPath = join(root, 'site', 'extension-latest.json');
const prev = existsSync(latestPath) ? JSON.parse(readFileSync(latestPath, 'utf8')) : {};
const latest = {
  version,
  minVersion: prev.minVersion || version,
  publishedAt: new Date().toISOString().slice(0, 10),
  download: `/downloads/${name}`,
  storeUrl: prev.storeUrl || '',
  // Version live on the Chrome Web Store (set by hand when the store approves a version).
  storeVersion: prev.storeVersion || '',
};
writeFileSync(latestPath, JSON.stringify(latest, null, 2) + '\n');
console.log(`Built ${name} (${files.length} files) → dist/ and site/downloads/; site/extension-latest.json → ${version}`);
