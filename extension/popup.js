const $ = (id) => document.getElementById(id);
const CONSENT_VERSION = 2; // 2: groups count added (v0.2.0)
const LABEL = { waiting: 'waiting', reading: 'reading…', done: 'read', missing: 'not found' };
const ERRORS = {
  signed_out: 'Please sign in to LinkedIn in this browser, then click Grade me again.',
  busy: 'Gauge is already reading your pages.',
  cancelled: 'The reading window was closed, so the test stopped. Click Grade me to start again.',
  no_consent: 'Please accept the notice first.',
};

async function show() {
  // CONSENT_VERSION goes up whenever the list of figures read changes, so the notice is shown again.
  const { consent, consentVersion } = await chrome.storage.local.get(['consent', 'consentVersion']);
  const ok = consent && consentVersion >= CONSENT_VERSION;
  $('consent').hidden = !!ok;
  $('main').hidden = !ok;
  render((await chrome.storage.session.get('progress')).progress);
}

function render(p) {
  const ol = $('steps');
  ol.textContent = '';
  if (!p) return;
  for (const s of p.status || []) {
    const li = document.createElement('li');
    const a = document.createElement('span');
    a.textContent = s.label;
    const b = document.createElement('span');
    b.textContent = LABEL[s.state] || s.state;
    b.className = 's-' + s.state;
    li.append(a, b);
    ol.append(li);
  }
  $('grade').disabled = !!p.running;
  $('msg').textContent = p.error ? ERRORS[p.error] || 'Something went wrong. Please try again.' : p.done ? 'Done. Your report is open in a new tab.' : '';
}

$('agree').addEventListener('click', async () => {
  await chrome.storage.local.set({ consent: new Date().toISOString(), consentVersion: CONSENT_VERSION });
  show();
});
$('revoke').addEventListener('click', async () => {
  await chrome.storage.local.clear();
  await chrome.storage.session.clear();
  show();
});
$('grade').addEventListener('click', async () => {
  $('grade').disabled = true;
  $('msg').textContent = 'Reading your pages…';
  const r = await chrome.runtime.sendMessage({ type: 'grade' });
  if (r?.error) $('msg').textContent = ERRORS[r.error] || 'Something went wrong. Please try again.';
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.progress) render(changes.progress.newValue);
});
show();
