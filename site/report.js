import { computeGrade, decodeSignals } from '/score.js';

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

  const lv = $('levers');
  for (const [group, title] of [['fill', 'What you fill'], ['work', 'What you work']]) {
    const items = r.levers.filter((l) => l.group === group && l.value != null);
    if (!items.length) continue;
    lv.append(el('p', 'group', title));
    for (const l of items) {
      const row = el('div', 'lever');
      const what = el('div');
      what.append(el('b', null, l.name), el('span', null, l.detail));
      const track = el('div', 'track');
      const f = el('div', 'fill ' + tone(l.value));
      f.style.width = l.value + '%';
      track.append(f);
      row.append(what, track, el('span', 'val num', l.value + '%'));
      lv.append(row);
    }
  }

  if (r.moves.length) {
    for (const mv of r.moves) {
      const d = el('div', 'move');
      d.append(el('span', 'gain num', `+${mv.gain} pts`), el('b', null, mv.title), el('span', null, mv.why));
      $('moves').append(d);
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
    $('missing').textContent = r.notRead.join(', ') + '. These were left out of the percentage.';
  }
}

async function save(r) {
  try {
    const me = await fetch('/api/me', { credentials: 'same-origin' }).then((x) => (x.ok ? x.json() : null));
    if (!me?.signedIn) {
      $('save').hidden = false;
      return;
    }
    $('who-name').textContent = me.name;
    await fetch('/api/grade', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        overall: r.overall, fill: r.fill, work: r.work, grade: r.grade,
        levers: Object.fromEntries(r.levers.filter((l) => l.value != null).map((l) => [l.id, l.value])),
      }),
    });
  } catch {}
}
