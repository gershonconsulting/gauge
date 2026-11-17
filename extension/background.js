// Gauge — service worker. Runs only when the user clicks "Grade me" in the popup.
// It opens the user's own LinkedIn pages one at a time in a single minimized window (so nothing
// appears in the user's tab strip), reads the visible figures, closes that window, then opens the
// Gauge report. If a minimized window cannot be created it falls back to one background tab.
// No timers, no scheduled or automatic runs,
// nothing is clicked, typed or sent on LinkedIn.
import { parseSsi, parseInvitations, parseDashboard, parseContent, parseLists, parseSalesNav, parseGroups } from './parsers.js';
import { parsePageVisitors, adminPageId } from './page-parsers.js';

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
  { key: 'groups', label: 'Your groups', url: `${LI}/groups/`, read: readGroups },
  { key: 'page', label: 'Company Page visitors (Page admins only)', url: `${LI}/feed/`, read: readCompanyPage },
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

// Navigate an existing tab and wait until it has loaded. The listener is attached before the
// navigation starts so a fast load cannot be missed.
function navigate(tabId, url, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const done = () => {
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(t);
      resolve();
    };
    const listener = (id, info) => id === tabId && info.status === 'complete' && done();
    const t = setTimeout(done, timeout);
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.update(tabId, { url }).catch((e) => {
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(t);
      reject(e);
    });
  });
}

// The reading surface: one minimized window with one tab, reused for every page. Returns the tab
// id and a close() function. Background tab as a fallback (e.g. a browser that refuses minimized windows).
export async function openReader() {
  try {
    const win = await chrome.windows.create({ url: 'about:blank', state: 'minimized', type: 'normal' });
    const tabId = win.tabs?.[0]?.id ?? (await chrome.tabs.query({ windowId: win.id }))[0].id;
    return { tabId, mode: 'window', close: () => chrome.windows.remove(win.id).catch(() => {}) };
  } catch {
    const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
    return { tabId: tab.id, mode: 'tab', close: () => chrome.tabs.remove(tab.id).catch(() => {}) };
  }
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

// Company Page visitors: find a Page the user administers from the links on their own feed, then
// read the 30-day visitor count on that Page's analytics. Not a Page admin = no reading, which
// leaves the "Page visitors worked" lever out of the grade. Visitor names are never read.
async function readCompanyPage(tabId) {
  let id = null;
  for (let i = 0; i < 6 && !id; i++) {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({ hrefs: [...document.querySelectorAll('a[href*="/company/"]')].map((a) => a.getAttribute('href')), url: location.href }),
    });
    if (/\/(login|uas\/login|checkpoint|authwall)/.test(res?.result?.url || '')) return { error: 'signed_out' };
    id = adminPageId(res?.result?.hrefs);
    if (!id) await sleep(1500);
  }
  if (!id) return { data: { admin: false } };
  await navigate(tabId, `${LI}/company/${id}/admin/analytics/visitors/`);
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const { text } = await scrollAndRead(tabId);
    const v = parsePageVisitors(text);
    if (v) return { data: { admin: true, ...v } };
    await sleep(1500);
  }
  return { data: { admin: true, visitors30d: null } };
}

// Sales Navigator fills its lists 8–12 s after load: wait for content, not a fixed delay.
async function readPage(page, tabId) {
  try {
    await chrome.tabs.get(tabId);
  } catch {
    return { error: 'cancelled' }; // the user closed Gauge's reading window
  }
  try {
    await navigate(tabId, page.url);
    if (page.read) return await page.read(tabId);
    let last = null;
    let lastJson = '';
    const deadline = Date.now() + 75000; // the invitations page needs ~40 s of scrolling
    while (Date.now() < deadline) {
      const { text, url, frozen } = await pageText(tabId, page.scroll);
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
  }
}

async function grade() {
  // Consent must cover the current list of figures (2: groups count, 3: company Page visitor count).
  const stored = await chrome.storage.local.get(['consent', 'consentVersion']);
  const consent = stored.consentVersion >= 3 ? stored.consent : null;
  if (!consent) return { error: 'no_consent' };
  if (running) return { error: 'busy' };
  running = true;
  try {
    const out = {};
    const status = PAGES.map((p) => ({ key: p.key, label: p.label, state: 'waiting' }));
    const reader = await openReader();
    try {
      for (let i = 0; i < PAGES.length; i++) {
        status[i].state = 'reading';
        await setProgress({ running: true, status });
        const r = await readPage(PAGES[i], reader.tabId);
        if (r.error === 'signed_out' || r.error === 'cancelled') {
          await setProgress({ running: false, status, error: r.error });
          return { error: r.error };
        }
        out[PAGES[i].key] = r.data || null;
        status[i].state = r.data ? 'done' : 'missing';
        await setProgress({ running: true, status });
      }
    } finally {
      await reader.close();
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
      groups: out.groups,
      page: out.page?.visitors30d != null ? { visitors30d: out.page.visitors30d } : null,
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
