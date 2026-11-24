import { computeGrade, decodeSignals } from '/score.js';
import { leverList, moveCard } from '/levers-ui.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const KEY = 'gauge_signals';

// Figures arrive in the URL fragment (never sent to the server). Keep them in this tab only,
// then strip them from the address bar.
let signals = null;
const m = location.hash.match(/d=([A-Za-z0-9_-]+)/);
if (m) {
  signals = decodeSignals(m[1]);
  if (signals) sessionStorage.setItem(KEY, JSON.stringify(signals));
  history.replaceState(null, '', '/report');
} else {
  try { signals = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch { signals = null; }
}

const r = signals ? computeGrade(signals) : null;
if (!r || r.overall == null) {
  $('empty').hidden = false;
} else {
  render(r, signals);
  $('report').hidden = false;
  save(r);
  // Anonymous campaign count: only fresh figures (not a reload), only if the visitor came via ?src=.
  if (m) fetch('/api/event', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'report' }) }).catch(() => {});
}

function tone(v) { return v >= 70 ? 'good' : v >= 45 ? 'warn' : 'bad'; }

function render(r, s) {
  $('read-at').textContent = 'Read on ' + new Date(s.readAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  $('dial-fill').setAttribute('stroke-dasharray', `${(r.overall / 100) * 282.7} 400`);
  $('dial-pct').textContent = r.overall + '%';
  $('dial-sub').textContent = 'of capacity used · grade ' + r.grade;
  $('dial').setAttribute('aria-label', `${r.overall} percent of Sales Navigator capacity used, grade ${r.grade}`);
  $('headline').textContent = `You are using ${r.overall}% of your Sales Navigator capacity!`;
  $('fill').textContent = r.fill == null ? '—' : r.fill + '%';
  $('work').textContent = r.work == null ? '—' : r.work + '%';
  if (r.fill != null) $('fill').className = 'num t-' + (r.fill >= 70 ? 'good' : 'bad');
  if (r.work != null) $('work').className = 'num t-' + (r.work >= 70 ? 'good' : 'bad');
  $('verdict').textContent =
    r.fill != null && r.work != null && r.fill - r.work >= 20
      ? 'You fill the tool well, then work much less of what you put in. The gap between those two numbers is where your next meetings are.'
      : r.work != null && r.fill != null && r.work - r.fill >= 20
        ? 'You work what you have well. Feeding the tool more leads and invitations would give that effort more to work on.'
        : 'Here is where your Sales Navigator capacity goes, lever by lever.';

  const chips = $('chips');
  if (s.ssi?.total != null) chips.append(el('span', 'chip', 'LinkedIn SSI ' + s.ssi.total));
  if (s.ssi?.industryTop != null) chips.append(el('span', 'chip', `Top ${s.ssi.industryTop}% of your industry`));
  if (s.ssi?.networkTop != null) chips.append(el('span', 'chip', `Top ${s.ssi.networkTop}% of your network`));

  $('levers').append(leverList(r.levers));

  if (r.moves.length) {
    for (const mv of r.moves) {
      $('moves').append(moveCard(mv));
    }
    $('path').textContent = `Today ${r.overall}% → with these three ${r.after}% (grade ${r.afterGrade})`;
  } else $('moves-card').hidden = true;

  const k = r.kpis;
  const kp = [
    [k.engagementsPer1000, (v) => v, 'engagements per 1,000 impressions on your posts (90 days)'],
    [k.oldInvitesShare, (v) => v + '%', 'of the pending invitations read are two weeks old or more'],
    [k.pendingInvites, (v) => v.toLocaleString('en-US'), 'invitations waiting for an answer'],
    [k.impressionsPerFollower, (v) => v, 'impressions per follower in 90 days'],
    [k.profileViewers, (v) => v.toLocaleString('en-US'), 'profile viewers (as shown on your dashboard)'],
    [k.searchAppearances, (v) => v.toLocaleString('en-US'), 'search appearances (as shown on your dashboard)'],
  ].filter(([v]) => v != null);
  if (!kp.length) $('kpi-card').hidden = true;
  for (const [v, f, label] of kp) {
    const d = el('div', 'kpi');
    d.append(el('b', 'num', String(f(v))), el('span', null, label));
    $('kpis').append(d);
  }

  if (r.notRead.length) {
    $('missing-card').hidden = false;
    $('missing').textContent = r.notRead.join(', ') + '. These were left out of the percentage. Usually LinkedIn had not finished loading that page: click the line above to open it, check you are signed in to Sales Navigator, then press "Grade me" again. If it still says "not read", use the Support page (gauge.gershon.ai/support).';
  }
}

async function shareBox() {
  const box = $('share-gershon');
  const cb = $('share-gershon-cb');
  if (!box || !cb) return;
  const cur = await fetch('/api/settings', { credentials: 'same-origin' }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
  if (!cur || cur.storage === false) return;
  cb.checked = cur.shareWithGershon === true;
  box.hidden = false;
  cb.addEventListener('change', async () => {
    cb.disabled = true;
    const r = await fetch('/api/settings', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shareWithGershon: cb.checked }) }).catch(() => null);
    if (r?.ok) $('share-gershon-st').textContent = cb.checked ? ' Shared. Thank you.' : ' Not shared.';
    else { cb.checked = !cb.checked; $('share-gershon-st').textContent = ' Could not save. Try again.'; }
    cb.disabled = false;
  });
}

async function save(r) {
  try {
    const me = await fetch('/api/me', { credentials: 'same-origin' }).then((x) => (x.ok ? x.json() : null));
    if (!me?.signedIn) {
      $('save').hidden = false;
      return;
    }
    $('who-name').textContent = me.name;
    // Raw figures leave this tab only when an admin switched on "send my full figures" in Settings.
    const st = await fetch('/api/settings', { credentials: 'same-origin' }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
    const res = await fetch('/api/grade', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        overall: r.overall, fill: r.fill, work: r.work, grade: r.grade,
        levers: Object.fromEntries(r.levers.filter((l) => l.value != null).map((l) => [l.id, l.value])),
        at: signals?.readAt,
        ...(st?.sendFigures === true ? { figures: signals } : {}),
      }),
    });
    const out = await res.json().catch(() => ({}));
    if (out.saved) $('saved').hidden = false;
    if (out.saved) shareBox();
  } catch {}
}
