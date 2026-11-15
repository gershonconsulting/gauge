import { LINKEDIN_ORIGIN } from './config.js';

const $ = (id) => document.getElementById(id);

function render(progress, hasResult) {
  const running = progress?.status === 'running';
  $('go').disabled = running;
  $('progress').classList.toggle('hidden', !running);
  if (running) {
    $('plabel').textContent = `Step ${progress.step} of ${progress.total}: ${progress.label}…`;
    $('pbar').style.width = `${Math.round((progress.step / progress.total) * 100)}%`;
  }
  const msg = progress?.status === 'error' ? `Something went wrong: ${progress.message}`
    : progress?.status === 'cancelled' ? 'Cancelled. Your report shows what was read before you stopped.'
    : '';
  $('msg').textContent = msg;
  $('msg').classList.toggle('hidden', !msg);
  $('report').classList.toggle('hidden', !hasResult || running);
}

async function refresh() {
  const { gaugeProgress, gaugeResult } = await chrome.storage.local.get(['gaugeProgress', 'gaugeResult']);
  render(gaugeProgress, !!gaugeResult);
}

$('go').addEventListener('click', async () => {
  // Host access to linkedin.com is optional and requested here, at the moment of the click.
  const granted = await chrome.permissions.request({ origins: [LINKEDIN_ORIGIN] });
  if (!granted) {
    $('msg').textContent = 'Gauge needs to read linkedin.com to grade you. Nothing was read.';
    $('msg').classList.remove('hidden');
    return;
  }
  await chrome.runtime.sendMessage({ type: 'start' });
});
$('cancel').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'cancel' }));
$('report').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('report.html') }));
chrome.storage.onChanged.addListener((c, area) => { if (area === 'local') refresh(); });
refresh();
