// Gauge in-page reader. Injected (after parsers.js) into the reading tab only after the
// user pressed "Grade me". It waits for real content, then returns ONLY the aggregate
// numbers produced by GaugeParsers. No names, profile URLs or message text are returned.
// The one click it ever makes is opening the "Saved searches" dialog on the Sales Navigator
// people search page (step 7).
(function () {
  'use strict';
  const P = globalThis.GaugeParsers;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const text = () => (document.body ? document.body.innerText || '' : '');

  async function waitFor(check, timeoutMs, everyMs = 500) {
    const end = Date.now() + timeoutMs;
    for (;;) {
      const t = text();
      const state = P.detectPageState(location.href, t, globalThis.__gaugePage);
      if (state !== 'ok') return { state, t };
      if (check(t)) return { state: 'ok', t, ready: true };
      if (Date.now() > end) return { state: 'ok', t, ready: false };
      await sleep(everyMs);
    }
  }

  // Pending invitations: scroll in small async steps until all rows are loaded, the list
  // stops growing, or the hard time cap is reached. Scrolling only, no clicks.
  async function loadInvitations(capMs) {
    const end = Date.now() + capMs;
    let last = -1, stableSince = Date.now();
    while (Date.now() < end) {
      const t = text();
      const inv = P.parseInvitations(t);
      if (inv.total != null && inv.rowsRead >= inv.total) break;
      if (inv.rowsRead !== last) { last = inv.rowsRead; stableSince = Date.now(); }
      else if (Date.now() - stableSince > 8000) break;
      const scroller = document.scrollingElement || document.documentElement;
      scroller.scrollTop += 700;
      for (const el of document.querySelectorAll('main, [class*="scaffold-finite-scroll"]')) {
        if (el.scrollHeight > el.clientHeight + 10) el.scrollTop += 700;
      }
      await sleep(400);
    }
    window.scrollTo(0, 0);
  }

  async function openSavedSearches(timeoutMs) {
    const btn = [...document.querySelectorAll('button')].find((b) =>
      /^\s*Saved searches\b/i.test(b.innerText || '') || /^Saved searches\b/i.test(b.getAttribute('aria-label') || ''));
    if (!btn) return null;
    btn.click();
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const dlg = document.querySelector('[role="dialog"]');
      if (dlg) {
        const t = dlg.innerText || '';
        const edits = dlg.querySelectorAll('[aria-label^="Edit "]').length;
        if (edits > 0 || P.ready.savedSearches(t)) {
          await sleep(1000); // let the remaining rows render
          return P.parseSavedSearches(dlg.innerText || '', dlg.querySelectorAll('[aria-label^="Edit "]').length);
        }
      }
      await sleep(500);
    }
    return null;
  }

  const PARSE = {
    ssi: P.parseSsi, dashboard: P.parseDashboard, content: P.parseContent,
    invitations: P.parseInvitations, leadLists: P.parseLeadLists, accountLists: P.parseAccountLists,
    inbox: P.parseInbox,
  };

  async function run(page, opts) {
    const o = Object.assign({ timeoutMs: 30000, scrollCapMs: 40000 }, opts || {});
    globalThis.__gaugePage = page;
    if (page === 'savedSearches') {
      const w = await waitFor((t) => /Saved searches/i.test(t), o.timeoutMs);
      if (w.state !== 'ok') return { state: w.state, data: null };
      if (!w.ready) return { state: 'timeout', data: null };
      const data = await openSavedSearches(15000);
      return data ? { state: 'ok', data } : { state: 'timeout', data: null };
    }
    const w = await waitFor(P.ready[page], o.timeoutMs);
    if (w.state !== 'ok') return { state: w.state, data: null };
    if (page === 'invitations' && w.ready) await loadInvitations(o.scrollCapMs);
    const data = PARSE[page](text());
    return { state: w.ready ? 'ok' : 'timeout', data };
  }

  globalThis.GaugeReader = Object.freeze({ run });
})();
