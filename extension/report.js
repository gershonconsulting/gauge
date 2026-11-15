import { LEVERS } from './score.js';
import { leverEvidence, evidenceGroups } from './evidence.js';
import { signalsFrom } from './steps.js';
import { BOOK_A_CALL_URL } from './config.js';

const $ = (id) => document.getElementById(id);
const show = (id, on) => $(id).classList.toggle('hidden', !on);
const el = (tag, props = {}, ...kids) => {
  const e = document.createElement(tag);
  Object.assign(e, props);
  for (const k of kids) if (k != null) e.append(k);
  return e;
};
const round = (x) => (x == null ? null : Math.round(x));
const pctText = (x) => (x == null ? '–' : `${Math.round(x)}%`);

$('book').href = BOOK_A_CALL_URL;
$('cancel').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'cancel' }));

function headline(overall) {
  return overall == null
    ? 'Not enough could be read to measure your Sales Navigator capacity.'
    : `You are using ${Math.round(overall)}% of your Sales Navigator capacity`;
}

function renderResult(r) {
  const sc = r.score;
  const overall = round(sc.overall);
  const signals = signalsFrom(r.pages || {});
  show('hero', true);
  $('overall').textContent = pctText(sc.overall);
  $('letter').textContent = sc.letter || '–';
  $('arc').setAttribute('stroke-dasharray', `${overall || 0} 100`);
  $('headline').textContent = headline(sc.overall);
  $('summary').textContent = r.signedOut
    ? 'You were not signed in to LinkedIn. Sign in at linkedin.com, then press Grade me again.'
    : r.noSalesNav ? 'No Sales Navigator seat was found, so Sales Navigator pages were skipped.' : '';
  $('readAt').textContent = `Read ${new Date(r.readAt).toLocaleString()}${r.cancelled ? ' (cancelled early, partial result)' : ''}`;

  $('filling').textContent = pctText(sc.filling);
  $('working').textContent = pctText(sc.working);
  show('tiles', true);

  const ev = leverEvidence(signals, sc);
  $('leverlist').replaceChildren(...LEVERS.map((l) => {
    const v = round(sc.levers[l.key]);
    const bar = el('div', { className: 'bar' }, el('span'));
    bar.firstChild.style.width = `${v || 0}%`;
    const note = ev[l.key] ? el('p', { className: 'muted', textContent: ev[l.key] }) : null;
    if (note) note.style.margin = '6px 0 0';
    return el('div', { className: 'area' },
      el('div', { className: 'area-head' },
        el('span', { textContent: `${l.label} · ${l.group === 'filling' ? 'filling' : 'working'}` }),
        el('span', { textContent: v == null ? 'not measured' : `${v}%` })),
      bar, note);
  }));
  show('levers', true);

  const moves = sc.moves || [];
  $('movelist').replaceChildren(...moves.map((m) => el('li', {},
    el('b', { textContent: m.label }), ' ',
    el('span', { className: 'pts', textContent: `+${Math.round(m.points)} points` }),
    el('div', { className: 'muted', textContent: m.move }))));
  show('moves', moves.length > 0);

  const groups = evidenceGroups(signals, sc);
  $('evidencelist').replaceChildren(...groups.map((g) => el('div', { className: 'group' },
    el('h3', { textContent: g.title }),
    el('ul', { className: 'evidence' }, ...g.lines.map((x) => el('li', {}, `${x.label}: `, el('b', { textContent: x.value })))))));
  show('evidence', groups.length > 0);

  $('missinglist').replaceChildren(...(r.unreadable || []).map((u) => el('li', { textContent: `${u.label}: ${u.reason}` })));
  show('missing', (r.unreadable || []).length > 0);
}

async function refresh() {
  const { gaugeProgress: p, gaugeResult: r } = await chrome.storage.local.get(['gaugeProgress', 'gaugeResult']);
  const running = p?.status === 'running';
  show('running', running);
  if (running) {
    $('rlabel').textContent = `Step ${p.step} of ${p.total}: ${p.label}…`;
    $('rbar').style.width = `${Math.round((p.step / p.total) * 100)}%`;
  }
  show('empty', !r && !running);
  if (r && !running) renderResult(r);
}

chrome.storage.onChanged.addListener((c, area) => { if (area === 'local') refresh(); });
refresh();
