import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parseSsi, parseInvitations, parseDashboard, parseContent, parseLists, parseSalesNav, parseGroups, daysAgo, toNumber } from '../extension/parsers.js';

const NOW = new Date(2026, 10, 14);

test('numbers: thousands and decimals', () => {
  assert.equal(toNumber('14,615'), 14615);
  assert.equal(toNumber('17.4'), 17.4);
  assert.equal(toNumber('10 000'), 10000);
});

test('SSI page', () => {
  const t = `Your Social Selling Index\n63\nout of 100\nEstablish your professional brand\n17.4\nFind the right people\n11.7\nEngage with insights\n8.5\nBuild relationships\n25\nIndustry SSI rank\nTop 2%\nNetwork SSI rank\nTop 6%`;
  assert.deepEqual(parseSsi(t), { total: 63, brand: 17.4, find: 11.7, engage: 8.5, relationships: 25, industryTop: 2, networkTop: 6 });
  assert.equal(parseSsi('Loading…'), null);
});

test('sent invitations: count and ages', () => {
  const t = `Sent (484)\nSent today\nSent 3 days ago\nSent 1 week ago\nSent 2 weeks ago\nSent 1 month ago`;
  assert.deepEqual(parseInvitations(t), { pending: 484, read: 5, under1w: 2, w1: 1, w2plus: 2 });
});

test('dashboard and content analytics', () => {
  assert.deepEqual(parseDashboard('14,615\nPost impressions\n30,538\nfollowers\n1,330\nProfile viewers\n361\nSearch appearances'),
    { impressions: 14615, followers: 30538, profileViewers: 1330, searchAppearances: 361 });
});

test('dates', () => {
  assert.equal(daysAgo('3 days ago', NOW), 3);
  assert.equal(daysAgo('Nov 3, 2026', NOW), 11);
  assert.equal(daysAgo('Mar 2025', NOW) > 300, true);
  assert.equal(daysAgo('Today', NOW), 0);
});

test('lists: count, freshness, no names returned', () => {
  const t = `Acme prospects\n120 leads\nUpdated Nov 3, 2026\nOld list\n40 leads\nUpdated Mar 12, 2025\nThird\n7 leads\n2 days ago`;
  const r = parseLists(t, NOW);
  assert.deepEqual(r, { savedTotal: null, lists: 3, updated30d: 2, items: 167 });
  assert.ok(!JSON.stringify(r).includes('Acme'));
});

test('Sales Navigator home', () => {
  assert.deepEqual(parseSalesNav('7,441 saved leads\n10,000 saved accounts\n0 InMail credits'), { inmailLeft: 0, savedLeads: 7441, savedAccounts: 10000 });
});

test('groups page: counts member lines only, never names, and sees lazy loading', () => {
  const t = `Groups listing\nYour groups\nRequested\nCreate group\nSaaS Founders Network\n481,559 members\nTiny Club\n1 member\nExport Leaders\n12 members\nLoading more results`;
  const r = parseGroups(t);
  assert.deepEqual(r, { joined: 3, loading: true });
  assert.ok(!JSON.stringify(r).includes('SaaS'));
  assert.deepEqual(parseGroups(t.replace('Loading more results', '')), { joined: 3, loading: false });
  assert.deepEqual(parseGroups('Groups listing\nYour groups\nYou have not joined any groups yet'), { joined: 0, loading: false });
  assert.equal(parseGroups('Sign in to LinkedIn'), null);
  assert.equal(parseGroups('Your groups\nPosted by 12 members today').joined, 0, 'only whole lines count');
});

test('background reads groups with short injected calls, no in-page timers', () => {
  const bg = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
  assert.ok(bg.includes('`${LI}/groups/`') && bg.includes('read: readGroups'));
  const fn = bg.slice(bg.indexOf('async function scrollAndRead'), bg.indexOf('async function readGroups'));
  assert.ok(!/setTimeout|setInterval/.test(fn), 'injected scroll call must not use timers');
});

const manifest = JSON.parse(readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));

test('manifest stays narrow for Chrome Web Store review', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual([...manifest.permissions].sort(), ['scripting', 'storage']);
  assert.deepEqual(manifest.host_permissions, ['https://www.linkedin.com/*']);
  for (const bad of ['tabs', 'cookies', 'webRequest', 'history', '<all_urls>', 'identity', 'activeTab']) {
    assert.ok(!JSON.stringify(manifest).includes(`"${bad}"`), 'must not request ' + bad);
  }
  // The only content script is the version flag, and it runs on the Gauge site only (never on LinkedIn).
  assert.deepEqual(manifest.content_scripts, [{ matches: ['https://gauge.gershon.ai/*'], js: ['site-flag.js'], run_at: 'document_start' }]);
  const flag = readFileSync(new URL('../extension/site-flag.js', import.meta.url), 'utf8');
  assert.ok(/dataset\.gaugeExt\s*=/.test(flag) && flag.includes("'gauge-ext'"));
  assert.ok(!/innerText|textContent|innerHTML|querySelector|sendMessage|chrome\.storage|fetch\(/.test(flag.replace(/^\s*\/\/.*$/gm, '')), 'site flag must not read the page or talk to anything');
  for (const s of [16, 32, 48, 128]) assert.ok(readdirSync(new URL('../extension/icons/', import.meta.url)).includes(`icon${s}.png`));
});

test('no remote code, no eval, consent gate present', () => {
  const dir = new URL('../extension/', import.meta.url);
  for (const f of readdirSync(dir).filter((f) => /\.(js|html)$/.test(f))) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    assert.ok(!/\beval\(|new Function\(/.test(src), f + ' uses eval');
    assert.ok(!/<script[^>]+src="https?:/.test(src), f + ' loads remote script');
    assert.ok(!/\bimport\s*\(\s*['"]https?:/.test(src), f + ' imports remote code');
  }
  const bg = readFileSync(new URL('background.js', dir), 'utf8');
  assert.ok(bg.includes("if (!consent) return { error: 'no_consent' }"), 'grading must refuse without consent');
  assert.ok(!/setInterval|chrome\.alarms/.test(bg), 'no background schedules');
  assert.ok(!/\/messaging|\/sales\/inbox/.test(bg), 'never opens message pages');
  const popup = readFileSync(new URL('popup.html', dir), 'utf8');
  assert.ok(popup.includes('I agree') && popup.includes('gauge.gershon.ai/privacy'));
});

// Shapes copied from the live pages on 2026-11-14 (names removed).
test('live SSI page: total comes from "out of 100", not "1 of 1"', () => {
  const t = 'Your Social Selling Index\n1 of 1\nIndustry SSI rank\nTop 2%\nNetwork SSI rank\nTop 6%\nCurrent Social Selling Index\nPie chart with 5 slices.\nEstablish your professional brand\t17.37\nFind the right people\t11.74\nEngage with insights\t8.45\nBuild relationships\t25\nRemaining points\t37\n63\nout of 100';
  assert.deepEqual(parseSsi(t), { total: 63, brand: 17.37, find: 11.74, engage: 8.45, relationships: 25, industryTop: 2, networkTop: 6 });
});

test('live invitations page: "People 484"', () => {
  const r = parseInvitations('Manage invitations\nReceived\nSent\nPeople 484\nSent 3 days ago\nSent 4 days ago\nSent 2 weeks ago');
  assert.deepEqual(r, { pending: 484, read: 3, under1w: 2, w1: 0, w2plus: 1 });
});

test('live content analytics: impressions after the label, not "90 days"', () => {
  const t = '32\n22\n99+\n90 days\nImpressions\n14,616\nImpressions\n279%\nvs. prior 90 days\n14,616\nImpressions\n32%\n68%\n7,623\nEngagement\n38\nSocial engagements\n30\n7';
  assert.deepEqual(parseContent(t), { impressions: 14616, engagements: 38 });
});

test('live dashboard', () => {
  const t = '32\n22\n99+\n436\nPost impressions in 7 days\n15%\nvs. prior 7 days\n30,538\nTotal followers\nvs. prior 7 days\n1,330\nProfile viewers in 90 days\n30%\nvs. prior 7 days\n361\nSearch appearances Nov 3–9\n0%';
  assert.deepEqual(parseDashboard(t), { impressions: 436, followers: 30538, profileViewers: 1330, searchAppearances: 361 });
});

test('live lead lists table and saved total', () => {
  const t = 'Lead lists\n All saved leads (7441)\nCreate lead list\nName\n\tLeads\t\nLast updated\n\tActions\nList A\n 100\n\t11/13/2026\t\nList B\n 382\n\t10/30/2026\t\nList C\n 40\n\t5/1/2025\t';
  assert.deepEqual(parseLists(t, NOW), { lists: 3, updated30d: 2, items: 522, savedTotal: 7441 });
});

test('live Sales Navigator settings: InMail', () => {
  assert.equal(parseSalesNav('Premium features\nInMail™ messages\n0 available.').inmailLeft, 0);
});

test('reading runs in one minimized window, user-started only, no new permissions', () => {
  const bg = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
  const m = JSON.parse(readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
  assert.ok(bg.includes("state: 'minimized'"));
  assert.ok(bg.includes('reader.close()'), 'reading window must always be closed');
  assert.ok(!/chrome\.alarms|setInterval/.test(bg), 'no scheduled or automatic runs');
  assert.deepEqual(m.permissions, ['scripting', 'storage']);
  assert.deepEqual(m.host_permissions, ['https://www.linkedin.com/*']);
  const popup = readFileSync(new URL('../extension/popup.html', import.meta.url), 'utf8');
  assert.ok(popup.includes('minimized Chrome window'), 'consent notice must say how pages are opened');
});
