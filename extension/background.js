// Gauge — service worker. Runs only when the user clicks "Grade me" in the popup.
// It opens the user's own LinkedIn pages one at a time in a background tab, reads the visible
// figures, closes the tab, then opens the Gauge report. No timers, no background activity,
// nothing is clicked, typed or sent on LinkedIn.
import { parseSsi, parseInvitations, parseDashboard, parseContent, parseLists, parseSalesNav, parseGroups } from './parsers.js';

const REPORT_URL = 'https://gauge.gershon.ai/report';
const LI = 'https://www.linkedin.com';

export const PAGES = [
  { key: 'ssi', label: 'Social Selling Index', url: `${LI}/sales/ssi`, parse: parseSsi },
  { key: 'invitations', label: 'Pending invitations', url: `${LI}/mynetwork/invitation-manager/sent/`, parse: parseInvitations, scroll: 12 },
  { key: 'dashboard', label: 'Your dashboard', url: `${LI}/dashboard/`, parse: parseDashboard },
  { key: 'content', label: 'Post results (90 days)', url: `${LI}/analytics/creator/content/?metricType=IMPRESSIONS&timeRange=past_90_days`, parse: parseContent },
  { key: 'listsPeople', label: 'Lead lists', url: `${LI}/sales/lists/people`, parse: (t) => parseLists(t), scroll: 4 },
  { key: 'listsCompany', label: 'Account lists', url: `${LI}/sales/lists/company`, parse: (t) => parseLists(t), scroll: 4 },
  { key: 'salesnav', label: 'Sales Navigator home', url: `${LI}/sales/home`, parse: parseSalesNav },
  { key: 'groups', label: 'Your groups', url: `${LI}/groups/`, read: readGroups },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let running = false;

async function setProgress(p) {
  await chrome.storage.session.set({ progress: p });
}


async function pageText(tabId, scroll) {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    args: [scroll || 0],
    func: async (times) => {
      for (let i = 0; i < times; i++) {
        window.scrollTo(0, document.body.scrollHeight);
        await new Promise((r) => setTimeout(r, 700));
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

// One short injected call: scroll to the bottom and return the text of <main>. No timers run in the
// page (timers in background tabs get throttled); the service worker does the waiting between calls.
async function scrollAndRead(tabId) {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      window.scrollTo(0, document.body.scrollHeight);
      const main = document.querySelector('main');
      return { text: (main || document.body)?.innerText || '', url: location.href };
    },
  });
  return res?.result || { text: '', url: '' };
}

// Groups lazy-load on scroll: keep scrolling until "Loading more results" is gone and the count
// has not changed for two reads, or 45 seconds have passed. Only the count is kept.
async function readGroups(tabId) {
  const deadline = Date.now() + 45000;
  let best = null;
  let stable = 0;
  while (Date.now() < deadline) {
    const { text, url } = await scrollAndRead(tabId);
    if (/\/(login|uas\/login|checkpoint|authwall)/.test(url)) return { error: 'signed_out' };
    const g = parseGroups(text);
    if (g) {
      stable = best && g.joined === best.joined && !g.loading ? stable + 1 : 0;
      best = { joined: g.joined };
      if (stable >= 2) break;
    }
    await sleep(1200);
  }
  return best ? { data: best } : { error: 'not_found' };
}

// Sales Navigator fills its lists 8–12 s after load: wait for content, not a fixed delay.
async function readPage(page) {
  const tab = await chrome.tabs.create({ url: page.url, active: false });
  try {
    await waitForLoad(tab.id);
    if (page.read) return await page.read(tab.id);
    let last = null;
    let lastJson = '';
    const deadline = Date.now() + 25000;
    let first = true;
    while (Date.now() < deadline) {
      const { text, url } = await pageText(tab.id, first ? page.scroll : 0);
      first = false;
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
  // Consent must cover the current list of figures (version 2 added the groups count).
  const stored = await chrome.storage.local.get(['consent', 'consentVersion']);
  const consent = stored.consentVersion >= 2 ? stored.consent : null;
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
      salesnav: mergeSalesNav(out.salesnav, null),
      groups: out.groups,
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

function mergeSalesNav(a, b) {
  if (!a && !b) return null;
  const pick = (k) => a?.[k] ?? b?.[k] ?? null;
  return { inmailLeft: pick('inmailLeft'), savedLeads: pick('savedLeads'), savedAccounts: pick('savedAccounts') };
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
