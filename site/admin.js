// Gauge admin page (/admin). Data comes from /api/admin/summary (admin accounts only).
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const day = (v) => (v ? new Date(v).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
const pct = (v) => (v == null ? '—' : v + '%');

async function getJson(url, opts) {
  const r = await fetch(url, { credentials: 'same-origin', ...opts });
  if (r.status === 401) { location.href = '/api/auth/linkedin/start?next=/admin'; throw new Error('signed_out'); }
  return [r, await r.json().catch(() => ({}))];
}

function kpi(value, label) { const d = el('div', 'kpi'); d.append(el('b', null, String(value)), el('span', null, label)); return d; }

async function load() {
  const [r, s] = await getJson('/api/admin/summary');
  if (!r.ok) { $('status').textContent = r.status === 403 ? 'This account is not a Gauge admin.' : 'Could not load the data.'; return; }
  if (s.storage === false) { $('status').textContent = 'Storage is not switched on for this site.'; return; }
  const T = s.totals, R = s.recent;
  $('status').textContent = `Updated ${day(new Date())}. Last daily report: ${s.lastReport ? day(s.lastReport) : 'not sent yet'}.`;
  $('email-state').textContent = s.emailReady ? 'Daily email: on (6 PM ET → report@gershonconsulting.com)' : 'Daily email: not switched on yet';
  $('kpis').replaceChildren(
    kpi(T.signedIn, 'signed in with LinkedIn'), kpi(T.graded, 'have a grade'), kpi(T.tests, 'tests run'),
    kpi(pct(T.average), 'average score'), kpi(R.signedIn, 'new sign-ins, 24 h'), kpi(R.tested, 'tested in the last 24 h'),
    kpi(T.invited, 'came through an invite'), kpi(`${T.shared} / ${T.signedIn}`, 'shared their result'));
  const max = Math.max(1, ...Object.values(T.grades));
  $('grades').replaceChildren(...Object.entries(T.grades).map(([g, n]) => {
    const d = el('div'); const i = el('i'); i.style.height = `${(70 * n) / max}px`; d.append(i, `${g} · ${n}`); return d;
  }));
  $('grades-card').hidden = T.graded === 0;

  if (!s.people.length) { $('people').replaceChildren(el('p', 'muted', 'Nobody has shared their result yet.')); return; }
  const table = el('table');
  const head = el('tr');
  for (const h of ['Name', 'Email', 'Score', 'Best', 'Tests', 'Last test', 'Joined', 'Invited by']) head.append(el('th', null, h));
  table.append(head);
  for (const p of s.people) {
    const tr = el('tr', 'click');
    const name = el('td');
    if (p.picture) { const img = el('img', 'av'); img.src = p.picture; img.alt = ''; name.append(img); }
    name.append(p.name || '—');
    if (p.isNew) name.append(' ', el('span', 'pill', 'new'));
    const mail = el('td'); const a = el('a', null, p.email); a.href = 'mailto:' + p.email; a.addEventListener('click', (e) => e.stopPropagation()); mail.append(a);
    tr.append(name, mail, el('td', null, p.overall == null ? '—' : `${p.overall}% · ${p.grade}`), el('td', null, pct(p.best)),
      el('td', null, String(p.tests)), el('td', null, day(p.lastAt)), el('td', null, day(p.joined)), el('td', null, p.invitedBy || '—'));
    tr.addEventListener('click', () => detail(p.id));
    table.append(tr);
  }
  $('people').replaceChildren(table);
}

const LEVERS = { inmail: 'InMail', invites: 'Invitations', savedAccounts: 'Saved accounts', savedLeads: 'Saved leads', groups: 'Groups', find: 'SSI find', engage: 'SSI engage', lists: 'Lists' };
async function detail(id) {
  const [r, d] = await getJson('/api/admin/member?id=' + encodeURIComponent(id));
  if (!r.ok) return;
  $('d-name').textContent = `${d.name} — ${pct(d.overall)} (${d.grade || '—'})`;
  const t = el('table'); const h = el('tr');
  for (const c of ['Date', 'Score', 'Grade', 'Filling', 'Working', ...Object.values(LEVERS)]) h.append(el('th', null, c));
  t.append(h);
  for (const x of [...d.history].reverse()) {
    const tr = el('tr');
    tr.append(el('td', null, day(x.at)), el('td', null, pct(x.overall)), el('td', null, x.grade || '—'), el('td', null, pct(x.fill)), el('td', null, pct(x.work)),
      ...Object.keys(LEVERS).map((k) => el('td', null, pct(x.levers?.[k]))));
    t.append(tr);
  }
  $('d-body').replaceChildren(d.history.length ? t : el('p', 'muted', 'No test saved yet.'));
  $('detail').classList.add('on');
  $('detail').scrollIntoView({ behavior: 'smooth' });
}
$('d-close').addEventListener('click', () => $('detail').classList.remove('on'));
$('send').addEventListener('click', async () => {
  $('send').disabled = true;
  const [, out] = await getJson('/api/admin/daily?force=1', { method: 'POST' });
  $('send').textContent = out.sent ? 'Sent ✓' : out.error === 'email_not_configured' ? 'Email not switched on yet' : 'Could not send';
  setTimeout(() => { $('send').textContent = "Send today's report now"; $('send').disabled = false; }, 4000);
});
load().catch(() => { $('status').textContent = 'Could not load the data.'; });
