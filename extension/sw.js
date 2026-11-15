// Gauge service worker. Does nothing until the user presses "Grade me" in the popup.
// Then it opens ONE tab, reads the user's own stats pages one after another, closes the tab,
// stores the result in chrome.storage.local and opens report.html. No network calls.
import { STEPS, unreadableList, signalsFrom } from './steps.js';
import { computeScore } from './score.js';
import { postScore } from './config.js';

const PAGE_TIMEOUT_MS = 30000;
const SCROLL_CAP_MS = 40000;
const LOAD_TIMEOUT_MS = 30000;

let current = null; // { cancelled, tabId }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const setProgress = (p) => chrome.storage.local.set({ gaugeProgress: { ...p, at: Date.now() } });
const badge = (text) => chrome.action.setBadgeText({ text }).catch(() => {});

chrome.runtime.onInstalled.addListener(() => chrome.action.setBadgeBackgroundColor({ color: '#FE1B04' }));

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;
  if (msg?.type === 'start') {
    if (current) { sendResponse({ ok: false, reason: 'running' }); return; }
    run().catch(async (e) => {
      await setProgress({ status: 'error', message: String(e?.message || e) });
      current = null;
      badge('');
    });
    sendResponse({ ok: true });
  } else if (msg?.type === 'cancel') {
    if (current) {
      current.cancelled = true;
      if (current.tabId != null) chrome.tabs.remove(current.tabId).catch(() => {});
    }
    sendResponse({ ok: true });
  }
});

// The user closing the reading tab counts as cancel.
chrome.tabs.onRemoved.addListener((tabId) => {
  if (current && current.tabId === tabId) current.cancelled = true;
});

// Wait until the tab left the previous page and finished loading (status "complete").
async function waitLoaded(tabId, prevUrl) {
  const end = Date.now() + LOAD_TIMEOUT_MS;
  const leftAt = Date.now() + 3000;
  while (Date.now() < end) {
    const tab = await chrome.tabs.get(tabId);
    const moved = tab.url !== prevUrl || Date.now() > leftAt;
    if (moved && tab.status === 'complete') return;
    await sleep(300);
  }
}

async function readStep(tabId, step) {
  const prev = (await chrome.tabs.get(tabId)).url;
  await chrome.tabs.update(tabId, { url: step.url });
  await waitLoaded(tabId, prev);
  await chrome.scripting.executeScript({ target: { tabId }, files: ['parsers.js', 'reader.js'] });
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (page, opts) => globalThis.GaugeReader.run(page, opts),
    args: [step.page, { timeoutMs: PAGE_TIMEOUT_MS, scrollCapMs: SCROLL_CAP_MS }],
  });
  return res?.result || { state: 'error', data: null };
}

async function run() {
  current = { cancelled: false, tabId: null };
  const pages = {};
  const total = STEPS.length;
  await chrome.storage.local.remove('gaugeProgress');
  await setProgress({ status: 'running', step: 0, total, label: 'Opening LinkedIn' });
  const tab = await chrome.tabs.create({ url: 'about:blank', active: true });
  current.tabId = tab.id;
  let signedOut = false, noSalesNav = false;

  for (let i = 0; i < total; i++) {
    const step = STEPS[i];
    if (current.cancelled) { pages[step.page] = { state: 'cancelled', data: null }; continue; }
    if (signedOut) { pages[step.page] = { state: 'signed_out', data: null }; continue; }
    if (noSalesNav && step.salesNav) { pages[step.page] = { state: 'no_sales_nav', data: null }; continue; }
    await setProgress({ status: 'running', step: i + 1, total, label: step.label });
    badge(`${i + 1}/${total}`);
    try {
      pages[step.page] = await readStep(current.tabId, step);
    } catch (e) {
      pages[step.page] = { state: current.cancelled ? 'cancelled' : 'error', data: null };
    }
    const st = pages[step.page].state;
    if (st === 'signed_out') signedOut = true;
    if (st === 'no_sales_nav') noSalesNav = true;
  }

  if (!current.cancelled) chrome.tabs.remove(current.tabId).catch(() => {});
  const cancelled = current.cancelled;
  const readAt = new Date().toISOString();
  const result = {
    version: chrome.runtime.getManifest().version,
    readAt,
    cancelled,
    signedOut,
    noSalesNav,
    pages,
    unreadable: unreadableList(pages),
    score: computeScore(signalsFrom(pages), new Date(readAt)),
  };
  await chrome.storage.local.set({ gaugeResult: result });
  await postScore(result); // disabled hook: returns immediately, sends nothing (see config.js)
  await setProgress({ status: cancelled ? 'cancelled' : 'done', step: total, total, label: cancelled ? 'Cancelled' : 'Done' });
  current = null;
  badge('');
  await chrome.tabs.create({ url: chrome.runtime.getURL('report.html') });
}
