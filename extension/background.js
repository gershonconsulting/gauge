// Gauge — service worker. Runs only when the user clicks "Grade me" in the popup.
// It opens the user's own LinkedIn pages one at a time in a background tab, reads the visible
// figures, closes the tab, then opens the Gauge report. No timers, no background activity,
// nothing is clicked, typed or sent on LinkedIn.
import { parseSsi, parseInvitations, parseDashboard, parseContent, parseLists, parseSalesNav } from './parsers.js';

const REPORT_URL = 'https://gauge.gershon.ai/report';
const LI = 'https://www.linkedin.com';

export const PAGES = [
  { key: 'ssi', label: 'Social Selling Index', url: `${LI}/sales/ssi`, parse: parseSsi },
  { key: 'invitations', label: 'Pending invitations', url: `${LI}/mynetwork/invitation-manager/sent/`, parse: parseInvitations, scroll: 50 },
  { key: 'dashboard', label: 'Your dashboard', url: `${LI}/dashboard/`, parse: parseDashboard },
  { key: 'content', label: 'Post results (90 days)', url: `${LI}/analytics/creator/content/?metricType=IMPRESSIONS&timeRange=past_90_days`, parse: parseContent },
  { key: 'listsPeople', label: 'Lead lists', url: `${LI}/sales/lists/people`, parse: (t) => parseLists(t), scroll: 4 },
  { key: 'listsCompany', label: 'Account lists', url: `${LI}/sales/lists/company`, parse: (t) => parseLists(t), scroll: 4 },
  { key: 'salesnav', label: 'InMail credits', url: `${LI}/sales/settings`, parse: parseSalesNav },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let running = false;

async function setProgress(p) {
  await chrome.storage.session.set({ progress: p });
}


// A frozen LinkedIn page (seen live on /sales/ssi) must not hang the whole run.
async function pageText(tabId, scroll) {
  const timeout = new Promise((r) => setTimeout(() => r({ text: '', url: '', frozen: true }), 60000));
  return Promise.race([readOnce(tabId, scroll), timeout]);
}

async function readOnce(tabId, scroll) {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    args: [scroll || 0],
    func: async (times) => {
      // LinkedIn lists scroll inside <main>, not the window: scroll both, stop when nothing new loads.
      let same = 0;
      let len = document.body ? document.body.innerText.length : 0;
      for (let i = 0; i < times && same < 3; i++) {
        window.scrollTo(0, document.body.scrollHeight);
        for (const el of [document.scrollingElement, document.querySelector('main')]) if (el) el.scrollTop = el.scrollHeight;
        await new Promise((r) => setTimeout(r, 800));
        const now = document.body.innerText.length;
        same = now === len ? same + 1 : 0;
        len = now;
      }
      return { text: document.body ? document.body.innerText : '', url: location.href };
    },
  });
  return res?.result || { text: '', url: '' };
}

function waitForLoad(tabId, timeout = 20000) {
  return new Promise((resolve) => {
    const done = () => {
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(t);
      resolve();
    };
    const listener = (id, info) => id === tabId && info.status === 'complete' && done();
    const t = setTimeout(done, timeout);
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// Sales Navigator fills its lists 8–12 s after load: wait for content, not a fixed delay.
async function readPage(page) {
  const tab = await chrome.tabs.create({ url: page.url, active: false });
  try {
    await waitForLoad(tab.id);
    let last = null;
    let lastJson = '';
    const deadline = Date.now() + 75000; // the invitations page needs ~40 s of scrolling
    while (Date.now() < deadline) {
      const { text, url, frozen } = await pageText(tab.id, page.scroll);
      if (frozen) break;
      if (/\/(login|uas\/login|checkpoint|authwall)/.test(url)) return { error: 'signed_out' };
      if (/\/premium\//.test(url)) return { error: 'no_sales_nav' };
      const parsed = page.parse(text);
      const json = JSON.stringify(parsed);
      if (parsed && json === lastJson) return { data: parsed };
      last = parsed;
      lastJson = json;
      await sleep(1500);
    }
    return last ? { data: last } : { error: 'not_found' };
  } catch (e) {
    return { error: 'read_failed' };
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function grade() {
  const { consent } = await chrome.storage.local.get('consent');
  if (!consent) return { error: 'no_consent' };
  if (running) return { error: 'busy' };
  running = true;
  try {
    const out = {};
    const status = PAGES.map((p) => ({ key: p.key, label: p.label, state: 'waiting' }));
    for (let i = 0; i < PAGES.length; i++) {
      status[i].state = 'reading';
      await setProgress({ running: true, status });
      const r = await readPage(PAGES[i]);
      if (r.error === 'signed_out') {
        await setProgress({ running: false, status, error: 'signed_out' });
        return { error: 'signed_out' };
      }
      out[PAGES[i].key] = r.data || null;
      status[i].state = r.data ? 'done' : 'missing';
      await setProgress({ running: true, status });
    }
    const signals = {
      v: 1,
      readAt: new Date().toISOString(),
      ssi: out.ssi,
      invitations: out.invitations,
      dashboard: out.dashboard,
      content: out.content,
      lists: { people: out.listsPeople, company: out.listsCompany },
      salesnav: {
        inmailLeft: out.salesnav?.inmailLeft ?? null,
        savedLeads: out.listsPeople?.savedTotal ?? out.salesnav?.savedLeads ?? null,
        savedAccounts: out.listsCompany?.savedTotal ?? out.salesnav?.savedAccounts ?? null,
      },
    };
    const d = encode(signals);
    await chrome.storage.local.set({ lastRead: signals.readAt });
    await setProgress({ running: false, status, done: true });
    await chrome.tabs.create({ url: `${REPORT_URL}#d=${d}` });
    return { ok: true };
  } finally {
    running = false;
  }
}

function encode(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg?.type === 'grade') {
      grade().then(reply);
      return true;
    }
    return false;
  });
}
