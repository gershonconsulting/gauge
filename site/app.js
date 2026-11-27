// Gauge app (/app): dashboard, history, compare, invite, share, extension, settings.
// Hash routes (#dashboard …). Everything is built with textContent; no external scripts, fonts or images
// (member photos are shown only for members who opted in, from the address LinkedIn gave at sign-in).
import { fromLevers } from '/score.js';
import { leverList, moveCard } from '/levers-ui.js';
import { trendChart, barChart, leverDelta } from '/charts.js';
import { levelFor, weeklyStreak, weeklyInvites, isPersonalBest, personalBest, inviteBadges, extensionState, compareVersions } from '/game.js';

const PAGES = ['dashboard', 'history', 'compare', 'invite', 'share', 'extension', 'settings'];
const PUBLIC_PAGES = new Set(['extension']); // usable while signed out
const $ = (id) => document.getElementById(id);
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function append(parent, ...kids) { for (const k of kids) if (k) parent.append(k); return parent; }
const card = (...kids) => append(el('section', 'card'), ...kids);
const fmtDate = (iso, opts = { month: 'short', day: 'numeric', year: 'numeric' }) => new Date(iso).toLocaleDateString('en-US', opts);
const short = (iso) => fmtDate(iso, { month: 'short', day: 'numeric' });
const tone = (v) => (v >= 70 ? 'good' : v >= 45 ? 'warn' : 'bad');
const initials = (name) => (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';

async function api(path, opts = {}) {
  const res = await fetch(path, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...opts });
  let body = null;
  try { body = await res.json(); } catch {}
  return { status: res.status, ok: res.ok, body: body || {} };
}

// Data, loaded once per visit and refreshed after changes.
const state = { me: null, cache: {} };
async function load(key, path) {
  if (!state.cache[key]) state.cache[key] = api(path).catch(() => ({ status: 0, ok: false, body: {} }));
  return state.cache[key];
}
const drop = (...keys) => keys.forEach((k) => delete state.cache[k]);

function noStorageCard(what) {
  return append(el('div', 'info'), el('p', null, `Saving is not switched on yet on this site, so ${what} cannot be shown. Your report still works after each test.`));
}
function errorCard() {
  return append(el('div', 'info'), el('p', null, 'This page could not load. Check your connection and refresh.'));
}
function avatar(name, picture) {
  const a = el('span', 'avatar');
  if (picture) {
    const img = el('img');
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    img.src = picture;
    img.onerror = () => { img.remove(); a.textContent = initials(name); };
    a.append(img);
  } else a.textContent = initials(name);
  return a;
}
function copyButton(getText, label = 'Copy') {
  const b = el('button', 'btn line small', label);
  b.type = 'button';
  b.addEventListener('click', async () => {
    const text = getText();
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch {
      const t = el('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.append(t); t.select();
      try { ok = document.execCommand('copy'); } catch {}
      t.remove();
    }
    b.textContent = ok ? 'Copied' : 'Select and copy';
    setTimeout(() => { b.textContent = label; }, 1800);
  });
  return b;
}

// ---------------------------------------------------------------- extension detection
let latestExt = null;
async function loadLatest() {
  if (!latestExt) latestExt = fetch('/extension-latest.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return latestExt;
}
function isChromium() {
  const brands = navigator.userAgentData?.brands;
  if (brands) return brands.some((b) => /Chromium|Google Chrome|Microsoft Edge/.test(b.brand));
  return /Chrome\/|Chromium\/|Edg\//.test(navigator.userAgent) && !/Firefox\//.test(navigator.userAgent);
}
// The extension's content script (gauge.gershon.ai only) sets data-gauge-ext="<version>".
// Chrome only injects it into pages loaded AFTER the extension is installed, so a tab that was open
// during the install never sees it. Fixes: wait longer, keep listening, and reload once the user comes
// back to this tab after going to the Chrome Web Store.
function installedVersion(wait = 2500) {
  const now = document.documentElement.dataset.gaugeExt;
  if (now) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = (v) => { document.removeEventListener('gauge-ext', on); resolve(v || null); };
    const on = () => done(document.documentElement.dataset.gaugeExt);
    document.addEventListener('gauge-ext', on);
    setTimeout(() => done(document.documentElement.dataset.gaugeExt), wait);
  });
}
const WAIT_KEY = 'gauge_wait_install';
function markStoreVisit(a) {
  a.addEventListener('click', () => { try { sessionStorage.setItem(WAIT_KEY, '1'); } catch {} });
  return a;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  let waiting = false;
  try { waiting = sessionStorage.getItem(WAIT_KEY) === '1'; } catch {}
  if (waiting && !document.documentElement.dataset.gaugeExt) location.reload();
});
document.addEventListener('gauge-ext', () => {
  try { sessionStorage.removeItem(WAIT_KEY); } catch {}
  if (state.me) route();
});
async function extInfo() {
  const [latest, installed] = await Promise.all([loadLatest(), installedVersion()]);
  if (installed) { try { sessionStorage.removeItem(WAIT_KEY); } catch {} }
  const chromium = isChromium();
  // Store users can only have what the store has published: compare with that, not with a build
  // that is still in review, otherwise everyone who installed from the store is told "outdated".
  const target = (latest?.storeUrl && latest?.storeVersion) || latest?.version || '0';
  return { latest, installed, chromium, target, state: extensionState({ chromium, installed, latest: target }) };
}
const canSync = () => document.documentElement.dataset.gaugeSync === '1';

// "Sync now": asks the extension (v0.5.0+) to run the same reading as "Grade me". The report opens
// in a new tab when it is done; the user stays in control (nothing runs without this click).
function syncButton(label = 'Sync now') {
  const wrap = el('div', 'sync');
  const b = el('button', 'btn', label);
  b.type = 'button';
  const msg = el('p', 'muted small');
  const ERR = {
    no_consent: 'The Gauge notice opened in a new tab: read it, click "I agree", then press "Grade me" there.',
    signed_out: 'Sign in to LinkedIn in this browser, then press Sync now again.',
    busy: 'Gauge is already reading your pages — the report will open by itself.',
    cancelled: 'The reading window was closed, so the sync stopped. Press Sync now to start again.',
  };
  b.addEventListener('click', () => {
    b.disabled = true;
    msg.textContent = 'Syncing… Gauge opens your LinkedIn pages in a small window behind this one (about 2 minutes). Your report opens in a new tab when it is done.';
    const on = (e) => {
      document.removeEventListener('gauge-sync-result', on);
      let r = {};
      try { r = JSON.parse(e.detail); } catch {}
      b.disabled = false;
      if (r.ok) { msg.textContent = 'Done — your report is open in a new tab. Refresh this page to see it on your dashboard.'; drop('history', 'compare'); }
      else msg.textContent = ERR[r.error] || 'The sync did not finish. Click the Gauge icon in your toolbar and press "Grade me".';
    };
    document.addEventListener('gauge-sync-result', on);
    document.dispatchEvent(new CustomEvent('gauge-sync'));
  });
  wrap.append(b, msg);
  return wrap;
}
function howToRun() {
  const ol = el('ol', 'steps');
  for (const t of [
    'Pin Gauge: click the puzzle-piece icon at the top right of Chrome, then the pin next to "Gauge". The red Gauge icon now stays in your toolbar.',
    'Make sure you are signed in to LinkedIn (and Sales Navigator) in this browser.',
    'Click the Gauge icon, read the short notice and click "I agree" (first time only).',
    'Click "Grade me". Gauge opens your own LinkedIn pages in a small window behind yours for about 2 minutes, then closes it.',
    'Your report opens. While you are signed in here, it is saved and appears on this dashboard.',
  ]) ol.append(el('li', null, t));
  return ol;
}

// ---------------------------------------------------------------- dashboard
function dial(overall, grade) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 220 138');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${overall} percent of Sales Navigator capacity used, grade ${grade}`);
  const path = (stroke, dash) => {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', 'M20 115a90 90 0 0 1 180 0');
    for (const [k, v] of Object.entries({ fill: 'none', stroke, 'stroke-width': 16, 'stroke-linecap': 'round' })) p.setAttribute(k, v);
    if (dash) p.setAttribute('stroke-dasharray', dash);
    return p;
  };
  const text = (y, cls, t) => {
    const x = document.createElementNS(NS, 'text');
    x.setAttribute('x', 110); x.setAttribute('y', y); x.setAttribute('text-anchor', 'middle'); x.setAttribute('class', cls);
    x.textContent = t;
    return x;
  };
  svg.append(path('#eef0f2'), path('#FE1B04', `${(overall / 100) * 282.7} 400`), text(102, 'pct', overall + '%'), text(128, 'outof', 'grade ' + grade));
  const d = el('div', 'dial');
  d.append(svg);
  return d;
}
function stat(big, label, cls) {
  const s = el('div', 'stat');
  const b = el('b', cls || null);
  if (big instanceof Node) b.append(big); else b.textContent = big;
  s.append(b, el('span', null, label));
  return s;
}

async function extBanner() {
  const b = $('banner');
  const info = await extInfo();
  b.replaceChildren();
  b.classList.remove('install');
  if (info.state !== 'missing' && info.state !== 'outdated') { b.hidden = true; return; }
  if (info.state === 'outdated') {
    const a = el('a', 'btn small', 'Update');
    a.href = '#extension';
    b.append(el('p', null, `An update of the Gauge extension is available: you have v${info.installed}, the latest is v${info.target}.`), a);
    b.hidden = false;
    return;
  }
  // Not installed: this is the first thing a new user must do, so it is the biggest thing on the page.
  b.classList.add('install');
  const latest = info.latest;
  const actions = el('div', 'actions');
  if (latest?.storeUrl) {
    const s = markStoreVisit(el('a', 'btn', 'Add Gauge to Chrome')); s.href = latest.storeUrl; s.target = '_blank'; s.rel = 'noopener';
    actions.append(s);
  } else if (latest?.download) {
    const d = el('a', 'btn', `Download the Chrome extension now (v${latest.version})`);
    d.href = latest.download; d.setAttribute('download', '');
    actions.append(d);
  }
  const how = el('a', 'btn line small', 'How to install');
  how.href = '#extension';
  const again = el('button', 'btn line small', 'I installed it — check again');
  again.type = 'button';
  again.addEventListener('click', () => location.reload());
  actions.append(how, again);
  append(b,
    el('span', 'step', 'Step 1 of 2'),
    el('h2', null, 'Download the Gauge Chrome extension now'),
    el('p', 'lead', 'The extension is what collects your Sales Navigator figures: SSI, invitations, InMails, lists, posts and groups. Without it there is nothing to grade.'),
    el('p', 'muted', 'It runs only when you press "Grade me", reads your own LinkedIn pages in your own browser, and never clicks, sends or posts anything.'),
    actions,
    el('p', 'muted small', 'Installed in another Chrome profile or browser? Open gauge.gershon.ai in that one: Gauge can only see the extension in the browser it is installed in.'));
  b.hidden = false;
}

async function renderDashboard(box) {
  const [h, c] = await Promise.all([load('history', '/api/history'), load('compare', '/api/compare')]);
  if (!h.ok) return box.replaceChildren(errorCard());
  if (h.body.storage === false) return box.replaceChildren(noStorageCard('your dashboard'));
  const items = h.body.items || [];
  if (!items.length) return box.replaceChildren(firstTestCard());
  const latest = items[0];
  const r = fromLevers(latest.levers);
  const out = [];

  // gamification strip
  const lvl = levelFor(latest.overall);
  const strip = el('div', 'strip');
  strip.append(stat(append(el('span', 'badge', lvl.name)), lvl.next ? `Level · ${lvl.toNext} pts to ${lvl.next}` : 'Level · top level'));
  const prev = items[1];
  if (prev) {
    const d = latest.overall - prev.overall;
    strip.append(stat((d > 0 ? '+' : '') + d, `since ${short(prev.at)}`, d > 0 ? 'up' : d < 0 ? 'down' : null));
  } else strip.append(stat('First test', 'your next test shows the change'));
  const streak = weeklyStreak(items.map((x) => x.at));
  strip.append(stat(streak + (streak === 1 ? ' week' : ' weeks'), 'weekly streak · one test a week keeps it'));
  const g = c.ok && c.body.global;
  if (g && g.percentile != null) strip.append(stat(`Ahead of ${g.percentile}%`, 'of Gauge users'));
  else strip.append(stat('Locked', `comparison with all users unlocks at ${g?.minUsers || 20} users`));
  out.push(strip);

  // hero
  const hero = el('section', 'card rhero');
  const right = el('div');
  const best = isPersonalBest(latest, items.slice(1));
  append(right,
    el('h1', null, `You are using ${latest.overall}% of your Sales Navigator capacity`),
    el('p', 'muted', `Test of ${fmtDate(latest.at)}${best && items.length > 1 ? ' · personal best' : ''}`));
  const split = el('div', 'split');
  const tile = (v, label) => {
    const d = el('div');
    const b = el('b', 'num', v == null ? '—' : v + '%');
    if (v != null) b.className = 'num t-' + (v >= 70 ? 'good' : 'bad');
    d.append(b, el('span', null, label));
    return d;
  };
  split.append(tile(latest.fill, 'Filling it: InMails, invitations, saved leads and accounts'), tile(latest.work, 'Working it: searches, engaging with prospects, lists'));
  right.append(split);
  hero.append(dial(latest.overall, latest.grade), right);
  out.push(hero);

  out.push(lastSyncCard(latest.at));
  out.push(trendCard(items));
  if (r.levers.some((l) => l.value != null)) {
    out.push(card(el('h2', null, 'Capacity, lever by lever'), el('p', 'muted', 'Each bar is what you use against what Sales Navigator gives you. Click a line to open that page on LinkedIn.'), leverList(r.levers)));
  }
  const inv = invitesCard(items);
  if (inv) out.push(inv);
  const moved = leverChangeCard(latest, prev);
  if (moved) out.push(moved);
  if (r.moves.length) {
    const moves = el('div', 'moves');
    for (const mv of r.moves) moves.append(moveCard(mv));
    out.push(card(el('h2', null, 'Three moves that add the most'), moves));
  }
  box.replaceChildren(...out);
}
// "Invitations sent per week": one row per week with a sync (see weeklyInvites in game.js).
const INVITES_PACE = 100;
function invitesCard(items) {
  const { rows, avg } = weeklyInvites(items);
  if (!rows.length) return null;
  const last = rows[0];
  const best = Math.max(...rows.map((r) => r.count));
  const kpis = el('div', 'kpis');
  kpis.append(
    stat(String(last.count), `last 7 days (to ${short(last.end)})`, last.count >= INVITES_PACE * 0.7 ? 'up' : 'down'),
    stat(String(avg), `average a week · ${rows.length} week${rows.length === 1 ? '' : 's'}`),
    stat(String(best), 'best week'),
    stat(last.pending != null ? last.pending.toLocaleString('en-US') : '—', 'pending in total'));
  const link = el('a', null, 'Open your Sent invitations on LinkedIn');
  link.href = 'https://www.linkedin.com/mynetwork/invitation-manager/sent/';
  link.target = '_blank';
  link.rel = 'noopener';
  return card(
    el('h2', null, 'Invitations sent per week'),
    el('p', 'muted', `Against a pace of ${INVITES_PACE} a week. Each bar is the 7 days before a sync — hover a bar for details.`),
    kpis,
    barChart(rows, INVITES_PACE),
    el('p', 'muted small', 'Counts are invitations still pending. Invitations people already accepted leave LinkedIn\'s Sent list, so the real number sent is a little higher. Paler bars were read at the following sync. Sync once a week (every Monday, for example) to build the full history.'),
    append(el('p', 'small'), link));
}

const SERIES = {
  all: [{ key: 'overall', name: 'Overall', color: '#FE1B04', width: 3, area: true }, { key: 'fill', name: 'Filling it', color: '#2563eb', dash: '6 4' }, { key: 'work', name: 'Working it', color: '#1a9e55', dash: '2 4' }],
  overall: [{ key: 'overall', name: 'Overall', color: '#FE1B04', width: 3, area: true }],
  fill: [{ key: 'fill', name: 'Filling it', color: '#2563eb', width: 3, area: true }],
  work: [{ key: 'work', name: 'Working it', color: '#1a9e55', width: 3, area: true }],
};
function trendCard(items) {
  const pts = [...items].reverse();
  const c = card(el('h2', null, 'Your progress'));
  const tabs = el('div', 'tabs');
  const holder = el('div');
  const legend = el('div', 'legend');
  const pick = (k) => {
    for (const b of tabs.children) b.classList.toggle('on', b.dataset.k === k);
    holder.replaceChildren(trendChart(pts, SERIES[k]));
    legend.replaceChildren(...SERIES[k].map((s) => { const i = el('span', null, s.name); i.style.setProperty('--c', s.color); return i; }));
  };
  for (const [k, label] of [['all', 'All'], ['overall', 'Overall'], ['fill', 'Filling it'], ['work', 'Working it']]) {
    const b = el('button', 'tab', label);
    b.type = 'button';
    b.dataset.k = k;
    b.addEventListener('click', () => pick(k));
    tabs.append(b);
  }
  c.append(append(el('div', 'cardhead'), tabs, legend), holder);
  if (pts.length < 2) c.append(el('p', 'muted small', 'One test so far: your next sync draws the line.'));
  pick('all');
  return c;
}
function leverChangeCard(latest, prev) {
  if (!prev?.levers) return null;
  const now = fromLevers(latest.levers).levers;
  const before = Object.fromEntries(fromLevers(prev.levers).levers.map((l) => [l.id, l.value]));
  const rows = now.filter((l) => l.value != null && before[l.id] != null).map((l) => ({ name: l.name, value: l.value, prev: before[l.id] }));
  if (!rows.length) return null;
  rows.sort((a, b) => Math.abs(b.value - b.prev) - Math.abs(a.value - a.prev));
  return card(el('h2', null, 'What moved since ' + short(prev.at)), el('p', 'muted', 'Solid bar = now, outline = previous test. Biggest changes first.'), leverDelta(rows));
}
function firstTestCard() {
  const c = card(el('span', 'step', 'Step 2 of 2'), el('h2', null, 'Run your first sync'),
    el('p', 'lead', 'The extension is installed, but it has not read anything yet. Gauge never runs on its own: it reads your figures only when you ask, so start the first sync now.'));
  if (canSync()) c.append(syncButton('Sync now — grade my Sales Navigator'), el('p', 'muted small', 'Or do it from the extension:'));
  c.append(howToRun());
  const a = el('a', 'btn line small', 'Extension status');
  a.href = '#extension';
  c.append(append(el('div', 'actions'), a));
  return c;
}
function lastSyncCard(at) {
  const days = Math.floor((Date.now() - new Date(at)) / 86400000);
  const when = days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
  const c = el('section', 'card syncbar' + (days >= 7 ? ' stale' : ''));
  const txt = el('div');
  txt.append(el('b', null, `Last sync: ${fmtDate(at)} (${when})`),
    el('span', 'muted small', days >= 7 ? ' · Your figures are over a week old. Sync once a week to keep your streak and see your progress.' : ' · Gauge syncs only when you ask. Once a week is enough.'));
  c.append(txt);
  if (canSync()) c.append(syncButton());
  else c.append(el('span', 'muted small', 'To sync: click the Gauge icon in your Chrome toolbar → "Grade me".'));
  return c;
}

// ---------------------------------------------------------------- history
function lineChart(items) {
  const NS = 'http://www.w3.org/2000/svg';
  const pts = [...items].reverse(); // oldest first
  const W = 640, H = 220, L = 34, R = 12, T = 12, B = 28;
  const x = (i) => (pts.length === 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (pts.length - 1));
  const y = (v) => T + ((100 - v) * (H - T - B)) / 100;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Overall percentage over time');
  const add = (tag, attrs, text) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text != null) n.textContent = text;
    svg.append(n);
    return n;
  };
  for (const v of [0, 50, 100]) {
    add('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'axis' });
    add('text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'lbl' }, v + '%');
  }
  add('text', { x: L, y: H - 8, class: 'lbl' }, short(pts[0].at));
  if (pts.length > 1) add('text', { x: W - R, y: H - 8, 'text-anchor': 'end', class: 'lbl' }, short(pts[pts.length - 1].at));
  if (pts.length > 1) add('polyline', { points: pts.map((p, i) => `${x(i)},${y(p.overall)}`).join(' '), fill: 'none', stroke: '#FE1B04', 'stroke-width': 2.5, 'stroke-linejoin': 'round' });
  const best = personalBest(items);
  pts.forEach((p, i) => {
    const isBest = p === best;
    const c = add('circle', { cx: x(i), cy: y(p.overall), r: isBest ? 6 : 3.5, fill: isBest ? '#d11200' : '#fff', stroke: '#FE1B04', 'stroke-width': 2 });
    const t = document.createElementNS(NS, 'title');
    t.textContent = `${fmtDate(p.at)}: ${p.overall}%${isBest ? ' (best)' : ''}`;
    c.append(t);
  });
  const d = el('div', 'chart');
  d.append(svg);
  return d;
}
async function renderHistory(box) {
  const h = await load('history', '/api/history');
  if (!h.ok) return box.replaceChildren(errorCard());
  if (h.body.storage === false) return box.replaceChildren(noStorageCard('your history'));
  const items = h.body.items || [];
  if (!items.length) return box.replaceChildren(firstTestCard());
  const best = personalBest(items);
  const chartCard = card(el('h2', null, 'Overall % over time'), el('p', 'muted', `${items.length} test${items.length === 1 ? '' : 's'} saved · best ${best.overall}% on ${fmtDate(best.at)}`), lineChart(items));
  const tbl = el('table', 'tbl');
  const head = el('tr');
  for (const [t, cls] of [['Date'], ['Overall'], ['Filling', 'hide-sm'], ['Working', 'hide-sm'], ['Grade'], ['']]) head.append(el('th', cls, t));
  tbl.append(append(el('thead'), head));
  const body = el('tbody');
  for (const it of items) {
    const tr = el('tr', 'clickable' + (it === best ? ' best' : ''));
    tr.tabIndex = 0;
    tr.title = 'Show the detail of this test';
    const pct = (v) => (v == null ? '—' : v + '%');
    tr.append(el('td', null, fmtDate(it.at)), el('td', null, pct(it.overall)), el('td', 'hide-sm', pct(it.fill)), el('td', 'hide-sm', pct(it.work)), el('td', null, it.grade));
    const tag = el('td');
    if (it === best) tag.append(el('span', 'badge', 'Best'));
    tr.append(tag);
    const detail = el('tr', 'detail');
    detail.hidden = true;
    const td = el('td');
    td.colSpan = 6;
    detail.append(td);
    const toggle = () => {
      if (!td.childElementCount) {
        const r = fromLevers(it.levers);
        td.append(leverList(r.levers));
        if (r.moves.length) td.append(append(el('div', 'moves'), ...r.moves.map(moveCard)));
      }
      detail.hidden = !detail.hidden;
    };
    tr.addEventListener('click', toggle);
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    body.append(tr, detail);
  }
  tbl.append(body);
  box.replaceChildren(chartCard, card(el('h2', null, 'Every test'), el('p', 'muted small', 'Click a test to see its levers; each line opens the LinkedIn page it comes from.'), append(el('div', 'tbl-wrap'), tbl)));
}

// ---------------------------------------------------------------- compare
async function renderCompare(box) {
  const c = await load('compare', '/api/compare');
  if (!c.ok) return box.replaceChildren(errorCard());
  if (c.body.storage === false) return box.replaceChildren(noStorageCard('the leaderboard'));
  const { circle = [], global = {}, pendingInCircle = 0 } = c.body;
  const out = [];
  const g = card(el('h2', null, 'Among all Gauge users'));
  if (global.percentile != null) g.append(el('p', null, `You are ahead of ${global.percentile}% of Gauge users.`));
  else if (!circle.some((x) => x.you)) g.append(el('p', 'muted', 'Run a test to see where you stand.'));
  else g.append(el('p', 'muted', `This comparison unlocks when ${global.minUsers || 20} people have a test (${global.users || 0} so far).`));
  out.push(g);

  const lb = card(el('h2', null, 'Your circle'), el('p', 'muted', 'You, the person who invited you and the people you invited, ranked by their latest overall %.'));
  if (!circle.length) lb.append(el('p', 'muted', 'Nobody in your circle has a test yet.'));
  else {
    const tbl = el('table', 'tbl');
    const head = el('tr');
    for (const [t, cls] of [['#'], ['Member'], ['Overall'], ['Change', 'hide-sm'], ['Rank move']]) head.append(el('th', cls, t));
    tbl.append(append(el('thead'), head));
    const body = el('tbody');
    for (const r of circle) {
      const tr = el('tr', r.you ? 'you' : null);
      const who = el('td');
      const wc = el('div', 'who-cell');
      const label = r.you ? `${r.name === 'Anonymous member' ? 'You' : r.name + ' (you)'}` : r.name + (r.invitedYou ? ' · invited you' : '');
      wc.append(avatar(r.name, r.picture), el('span', null, label));
      who.append(wc);
      const ch = el('td', 'hide-sm', r.change == null ? '—' : (r.change > 0 ? '+' : '') + r.change);
      if (r.change > 0) ch.classList.add('up'); else if (r.change < 0) ch.classList.add('down');
      const mv = el('td', null, r.movement == null ? '—' : r.movement > 0 ? `▲ ${r.movement}` : r.movement < 0 ? `▼ ${-r.movement}` : '=');
      if (r.movement > 0) mv.classList.add('up'); else if (r.movement < 0) mv.classList.add('down');
      tr.append(el('td', null, String(r.rank)), who, el('td', null, r.overall + '%'), ch, mv);
      body.append(tr);
    }
    tbl.append(body);
    lb.append(append(el('div', 'tbl-wrap'), tbl));
  }
  if (pendingInCircle) lb.append(el('p', 'muted small', `${pendingInCircle} more ${pendingInCircle === 1 ? 'person has' : 'people have'} signed in through your link but not run a test yet.`));
  const a = el('a', 'btn small', 'Invite people');
  a.href = '#invite';
  lb.append(append(el('div', 'actions'), a));
  lb.append(el('p', 'muted small', 'Names and photos appear only for members who turned on "Show my name and photo" in Settings.'));
  out.push(lb);
  box.replaceChildren(...out);
}

// ---------------------------------------------------------------- invite
async function renderInvite(box) {
  const i = await load('invite', '/api/invite');
  if (!i.ok) return box.replaceChildren(errorCard());
  if (i.body.storage === false) return box.replaceChildren(noStorageCard('your invite link'));
  const input = el('input');
  input.readOnly = true;
  input.value = i.body.link;
  input.setAttribute('aria-label', 'Your invite link');
  input.addEventListener('focus', () => input.select());
  const link = card(el('h2', null, 'Your invite link'), el('p', 'muted', 'Send it to people who use Sales Navigator. When they sign in and run a test, they join your circle on the Compare page.'), append(el('div', 'copyrow'), input, copyButton(() => i.body.link)));
  const counts = el('div', 'counts');
  counts.append(stat(String(i.body.signedIn), 'invited people who signed in'), stat(String(i.body.graded), 'invited people who completed a test'));
  const badges = el('div', 'badges');
  for (const b of inviteBadges(i.body.graded)) badges.append(el('span', b.earned ? 'badge' : 'badge off', `${b.name} · ${b.at}`));
  const bc = card(el('h2', null, 'Invite badges'), el('p', 'muted', 'Earned for invited people who complete a test.'), badges, el('p', 'muted small', 'Rewards for top inviters are coming.'));
  box.replaceChildren(link, counts, bc);
}

// ---------------------------------------------------------------- share
async function renderShare(box) {
  const [h, i] = await Promise.all([load('history', '/api/history'), load('invite', '/api/invite')]);
  if (!h.ok || !i.ok) return box.replaceChildren(errorCard());
  const link = i.body.link || 'https://gauge.gershon.ai';
  const latest = (h.body.items || [])[0];
  const post = sharePost(latest, link);
  const sc = el('div', 'sharecard');
  if (latest) sc.append(el('span', 'big', latest.overall + '%'));
  const ta = el('textarea', 'sharetext');
  ta.value = post;
  ta.rows = 14;
  ta.setAttribute('aria-label', 'Your LinkedIn post, edit it as you like');
  sc.append(ta);
  const li = el('button', 'btn small', 'Post it on LinkedIn');
  li.type = 'button';
  const note = el('p', 'muted small', 'Clicking copies the text and opens LinkedIn\'s own post box with it filled in. Check it, then press Post on LinkedIn. Gauge never posts for you.');
  li.addEventListener('click', async () => {
    const text = ta.value;
    try { await navigator.clipboard.writeText(text); } catch {}
    window.open('https://www.linkedin.com/feed/?shareActive=true&text=' + encodeURIComponent(text), '_blank', 'noopener');
    note.textContent = 'LinkedIn is open in a new tab with your post. If the box is empty, click "Start a post" and paste (Ctrl+V): the text is already copied.';
  });
  const c = card(el('h2', null, 'Tell your network why you measure your Sales Navigator ROI'),
    el('p', 'muted', latest ? 'A ready-to-post message with your score and your invite link. Edit it freely.' : 'A ready-to-post message about Gauge with your invite link. Run your first sync to add your own score.'),
    sc, append(el('div', 'actions'), li, copyButton(() => ta.value, 'Copy text')), note);
  box.replaceChildren(c);
}
function sharePost(latest, link) {
  const head = latest
    ? `I just measured my Sales Navigator ROI: I use ${latest.overall}% of the capacity I pay for (grade ${latest.grade}).`
    : 'How much of your Sales Navigator are you actually using?';
  return [
    head,
    '',
    'Sales Navigator is one of the most expensive seats in a sales stack, and most of us never check what we get for it.',
    '',
    'Gauge (by Gershon Consulting) measures it in one click, from your own LinkedIn figures:',
    '• InMail credits used before they expire',
    '• Connection invitations sent per week',
    '• Saved leads and accounts, groups joined',
    '• SSI: finding the right people, engaging with insights',
    '• Lists you actually keep working',
    '',
    'You get one percentage, a grade, and the three moves that add the most. Free, read-only, nothing is posted or sent for you.',
    '',
    latest ? 'What is your score? Measure yours here:' : 'Measure yours here:',
    link,
    '',
    '#SalesNavigator #SocialSelling #B2BSales #LinkedIn',
  ].join('\n');
}

function legalCard() {
  const box = el('div', 'legal');
  for (const [href, t] of [['/privacy', 'Privacy policy'], ['/terms', 'Terms'], ['/support', 'Support']]) {
    const a = el('a', null, t);
    a.href = href;
    box.append(a);
  }
  return card(el('h2', null, 'Legal'), el('p', 'muted', 'What Gauge reads and stores, the terms of use, and how to reach us.'), box);
}

// ---------------------------------------------------------------- extension
async function renderExtension(box) {
  const info = await extInfo();
  const latest = info.latest;
  const out = [];
  const s = card(el('h2', null, 'Status in this browser'));
  const line = el('div', 'state');
  const dot = el('span', 'dot');
  const labels = {
    unsupported: ['bad', 'Can’t check on this browser — Gauge works in Chrome and other Chromium browsers (Edge, Brave).'],
    missing: ['bad', 'Not installed'],
    outdated: ['warn', `Update available (you have v${info.installed}, latest is v${info.target})`],
    current: ['ok', `Installed — up to date (v${info.installed})`],
  };
  const [cls, label] = labels[info.state];
  dot.classList.add(cls);
  line.append(dot, el('span', null, label));
  s.append(line);
  if (info.state === 'current' && compareVersions(info.installed, info.target) > 0) s.append(el('p', 'muted small', 'You have a newer build than the site lists.'));
  out.push(s);

  const g = card(el('h2', null, info.state === 'outdated' ? 'Update the extension' : 'Get the extension'));
  const actions = el('div', 'actions');
  const store = latest?.storeUrl;
  if (store) {
    const a = markStoreVisit(el('a', 'btn small', 'Add to Chrome')); a.href = store; a.target = '_blank'; a.rel = 'noopener';
    actions.append(a);
  } else {
    const a = el('span', 'btn line small', 'Chrome Web Store');
    a.setAttribute('aria-disabled', 'true');
    a.append(el('span', 'tag', 'coming soon'));
    actions.append(a);
  }
  if (latest?.download) {
    const d = el('a', store ? 'btn line small' : 'btn small', `Download the extension (v${latest.version})`);
    d.href = latest.download;
    d.setAttribute('download', '');
    actions.prepend(d);
    if (store) actions.append(d);
  }
  g.append(actions);
  if (!store) {
    g.append(el('p', 'muted', 'Until the Chrome Web Store listing is live, install the downloaded file this way:'));
    const ol = el('ol', 'steps');
    for (const t of ['Unzip the downloaded file into a folder you keep.', 'Open chrome://extensions in Chrome and turn on "Developer mode" (top right).', 'Click "Load unpacked" and choose that folder. To update later, unzip the new version into the same folder and click the reload arrow on the Gauge card.'])
      ol.append(el('li', null, t));
    g.append(ol);
  }
  out.push(g);

  const run = card(el('h2', null, 'Run a test'));
  const ol = el('ol', 'steps');
  for (const t of ['Be signed in to LinkedIn in this browser.', 'Click the Gauge icon in your toolbar, accept the notice once, then click "Grade me".', 'Gauge reads your own figures for about two minutes and opens your report. If you are signed in here, the result is saved to your History.'])
    ol.append(el('li', null, t));
  const p = el('p', 'muted small');
  const pl = el('a', null, 'privacy policy');
  pl.href = '/privacy';
  p.append('What the extension reads and stores is in the ', pl, '.');
  run.append(ol, p);
  out.push(run, legalCard());
  box.replaceChildren(...out);
}

// ---------------------------------------------------------------- settings
async function renderSettings(box) {
  const s = await load('settings', '/api/settings');
  if (!s.ok) return box.replaceChildren(errorCard());
  const noKv = s.body.storage === false;
  const out = [];

  const lb = card(el('h2', null, 'Leaderboards'));
  const lab = el('label', 'toggle');
  const cb = el('input');
  cb.type = 'checkbox';
  cb.checked = s.body.showName === true;
  cb.disabled = noKv;
  const txt = el('span');
  txt.append(el('b', null, 'Show my name and photo on leaderboards'), el('br'), el('span', 'muted small', 'Off: you appear as "Anonymous member". Your email is never shown.'));
  lab.append(cb, txt);
  const st = el('p', 'status');
  cb.addEventListener('change', async () => {
    cb.disabled = true;
    st.textContent = 'Saving…';
    const r = await api('/api/settings', { method: 'POST', body: JSON.stringify({ showName: cb.checked }) }).catch(() => ({ ok: false }));
    if (r.ok) { st.textContent = 'Saved.'; drop('settings', 'compare'); } else { cb.checked = !cb.checked; st.textContent = 'Could not save. Try again.'; }
    cb.disabled = false;
  });
  lb.append(lab, st);
  if (noKv) lb.append(el('p', 'muted small', 'Saving is not switched on yet on this site.'));
  out.push(lb);

  const sh = card(el('h2', null, 'Share with Gershon Consulting'));
  const lab2 = el('label', 'toggle');
  const cb2 = el('input');
  cb2.type = 'checkbox';
  cb2.checked = s.body.shareWithGershon === true;
  cb2.disabled = noKv;
  const txt2 = el('span');
  txt2.append(el('b', null, 'Share my result with Gershon Consulting'), el('br'),
    el('span', 'muted small', 'On: the Gershon Consulting team can see your name, email and scores to help you improve. Off (default): they only see anonymous totals. Your LinkedIn data is never shared.'));
  lab2.append(cb2, txt2);
  const st2 = el('p', 'status');
  cb2.addEventListener('change', async () => {
    cb2.disabled = true;
    st2.textContent = 'Saving…';
    const r = await api('/api/settings', { method: 'POST', body: JSON.stringify({ shareWithGershon: cb2.checked }) }).catch(() => ({ ok: false }));
    if (r.ok) { st2.textContent = 'Saved.'; drop('settings'); } else { cb2.checked = !cb2.checked; st2.textContent = 'Could not save. Try again.'; }
    cb2.disabled = false;
  });
  sh.append(lab2, st2);
  out.push(sh);

  if (s.body.canSendFigures === true) {
    const fg = card(el('h2', null, 'My Gershon dashboard'));
    const lab3 = el('label', 'toggle');
    const cb3 = el('input');
    cb3.type = 'checkbox';
    cb3.checked = s.body.sendFigures === true;
    cb3.disabled = noKv;
    const txt3 = el('span');
    txt3.append(el('b', null, 'Send my full LinkedIn figures to my Gershon dashboard'), el('br'),
      el('span', 'muted small', 'On: each sync also saves the numbers Gauge read (SSI, invitations, profile views, impressions, InMail credits, saved leads and accounts, lists, groups, Page visitors) so tools.gershoncrm.com can show them. Numbers only, never names or text. Off (default): only your scores are saved, and turning it off deletes the saved figures.'));
    lab3.append(cb3, txt3);
    const st3 = el('p', 'status');
    cb3.addEventListener('change', async () => {
      cb3.disabled = true;
      st3.textContent = 'Saving…';
      const r = await api('/api/settings', { method: 'POST', body: JSON.stringify({ sendFigures: cb3.checked }) }).catch(() => ({ ok: false }));
      if (r.ok) { st3.textContent = cb3.checked ? 'Saved. Your next sync sends the figures.' : 'Saved. Figures deleted.'; drop('settings'); } else { cb3.checked = !cb3.checked; st3.textContent = 'Could not save. Try again.'; }
      cb3.disabled = false;
    });
    fg.append(lab3, st3);
    out.push(fg);
  }

  const del = card(el('h2', null, 'Delete my data'), el('p', 'muted', 'Deletes your profile, every saved test, your settings, your invite link and invite links in both directions, and your place on leaderboards. Then you are signed out. This cannot be undone.'));
  const start = el('button', 'btn danger small', 'Delete my data');
  start.type = 'button';
  const confirmBox = el('div', 'confirm');
  confirmBox.hidden = true;
  const yes = el('button', 'btn danger solid small', 'Yes, delete everything');
  yes.type = 'button';
  const no = el('button', 'btn line small', 'Cancel');
  no.type = 'button';
  const dst = el('p', 'status');
  confirmBox.append(el('p', null, 'Are you sure? Everything Gauge holds about you will be deleted now.'), append(el('div', 'actions'), yes, no), dst);
  start.addEventListener('click', () => { confirmBox.hidden = false; start.hidden = true; yes.focus(); });
  no.addEventListener('click', () => { confirmBox.hidden = true; start.hidden = false; dst.textContent = ''; });
  yes.addEventListener('click', async () => {
    yes.disabled = no.disabled = true;
    dst.textContent = 'Deleting…';
    const r = await api('/api/delete-me', { method: 'POST' }).catch(() => ({ ok: false }));
    if (r.ok) { dst.textContent = 'Deleted. Signing you out…'; location.assign('/'); } else { dst.textContent = 'Could not delete. Try again, or write to olivier@gershonconsulting.com.'; yes.disabled = no.disabled = false; }
  });
  del.append(append(el('div', 'actions'), start), confirmBox);
  out.push(del);

  const so = el('button', 'btn line small', 'Sign out');
  so.type = 'button';
  so.addEventListener('click', () => { fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).finally(() => { try { localStorage.removeItem('gauge_signed_in'); } catch {} location.assign('/'); }); });
  out.push(card(el('h2', null, 'Account'), el('p', 'muted', `Signed in with LinkedIn as ${state.me?.name || 'you'}.`), append(el('div', 'actions'), so)), legalCard());
  box.replaceChildren(...out);
}

// ---------------------------------------------------------------- router and shell
const RENDER = { dashboard: renderDashboard, history: renderHistory, compare: renderCompare, invite: renderInvite, share: renderShare, extension: renderExtension, settings: renderSettings };
const BOX = { dashboard: 'dash', history: 'hist', compare: 'cmp', invite: 'inv', share: 'shr', extension: 'ext', settings: 'set' };

function current() {
  const h = location.hash.replace(/^#/, '');
  return PAGES.includes(h) ? h : 'dashboard';
}
async function route() {
  const page = current();
  closeMenu();
  for (const a of document.querySelectorAll('.menu a')) {
    const on = a.dataset.page === page;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  for (const p of PAGES) $('page-' + p).hidden = true;
  $('banner').hidden = true;
  const signedIn = !!state.me;
  $('signed-out').hidden = signedIn || PUBLIC_PAGES.has(page);
  if (!signedIn && !PUBLIC_PAGES.has(page)) return;
  $('page-' + page).hidden = false;
  document.title = `Gauge — ${page[0].toUpperCase() + page.slice(1)}`;
  const box = $(BOX[page]);
  if (!box.childElementCount) box.append(el('p', 'muted', 'Loading…'));
  try { await RENDER[page](box); } catch { box.replaceChildren(errorCard()); }
  if (signedIn && page !== 'extension') extBanner().catch(() => {});
}

function openMenu() { $('side').classList.add('open'); $('scrim').hidden = false; $('menu-btn').setAttribute('aria-expanded', 'true'); }
function closeMenu() { $('side').classList.remove('open'); $('scrim').hidden = true; $('menu-btn').setAttribute('aria-expanded', 'false'); }
$('menu-btn').addEventListener('click', () => ($('side').classList.contains('open') ? closeMenu() : openMenu()));
$('scrim').addEventListener('click', closeMenu);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
window.addEventListener('hashchange', route);

(async () => {
  // HttpOnly session cookie: only call /api/me when this browser has signed in before, so a signed-out
  // visitor makes no 401 request. Sign-in links set the hint; a failed /api/me or logout clears it.
  const HINT = 'gauge_signed_in';
  const hint = (v) => { try { v ? localStorage.setItem(HINT, '1') : localStorage.removeItem(HINT); } catch {} };
  let hinted = false;
  try { hinted = localStorage.getItem(HINT) === '1'; } catch {}
  document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('a[href^="/api/auth/linkedin/start"]')) hint(true); });
  const me = hinted ? await api('/api/me').catch(() => ({ ok: false, body: {} })) : { ok: false, body: {} };
  if (hinted && !(me.ok && me.body.signedIn)) hint(false);
  state.me = me.ok && me.body.signedIn ? me.body : null;
  if (state.me) {
    $('side-who').hidden = false;
    $('side-name').textContent = state.me.name;
    $('side-avatar').replaceWith(Object.assign(avatar(state.me.name, state.me.picture), { id: 'side-avatar' }));
  }
  route();
})();
