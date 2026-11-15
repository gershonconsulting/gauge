// Gauge parsers: pure functions, text in -> aggregate numbers out.
// Runs in two places:
//   1. Injected into a LinkedIn tab (classic script via chrome.scripting) so that only
//      numbers, never names or message text, leave the page.
//   2. Imported by Node tests (as a side-effect module).
// It therefore has no import/export: it publishes itself on globalThis.GaugeParsers.
// Every parser returns null fields instead of throwing when something is missing.
(function () {
  'use strict';

  const num = (s) => {
    if (s == null) return null;
    const n = Number(String(s).replace(/[,\s  ]/g, ''));
    return Number.isFinite(n) ? n : null;
  };
  const m1 = (text, re) => {
    const m = re.exec(text || '');
    return m ? num(m[1]) : null;
  };
  const str = (t) => (typeof t === 'string' ? t : '');

  // M/D/YYYY -> YYYY-MM-DD (or null)
  const usDate = (s) => {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s || '').trim());
    if (!m) return null;
    const mo = +m[1], d = +m[2];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${m[3]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  };

  // 1. /sales/ssi
  function parseSsi(text) {
    const t = str(text);
    const comp = (label) => m1(t, new RegExp('(\\d+(?:\\.\\d+)?)\\s*\\n?\\s*' + label, 'i'));
    let industryAvg = null, networkAvg = null;
    const re = /([^.\n]*?)have an average SSI of\s*(\d+(?:\.\d+)?)/gi;
    let m;
    while ((m = re.exec(t))) {
      if (/network/i.test(m[1])) { if (networkAvg == null) networkAvg = num(m[2]); }
      else if (industryAvg == null) industryAvg = num(m[2]);
    }
    return {
      score: m1(t, /Current Social Selling Index[\s\S]{0,200}?(\d+(?:\.\d+)?)\s*out of\s*100/i) ?? m1(t, /(\d+(?:\.\d+)?)\s*out of\s*100/i),
      brand: comp('Establish your professional brand'),
      findPeople: comp('Find the right people'),
      insights: comp('Engage with insights'),
      relationships: comp('Build relationships'),
      industryRankTopPct: m1(t, /Industry SSI rank\s*:?\s*Top\s*(\d+(?:\.\d+)?)\s*%/i),
      networkRankTopPct: m1(t, /Network SSI rank\s*:?\s*Top\s*(\d+(?:\.\d+)?)\s*%/i),
      industryAvg,
      networkAvg,
    };
  }

  // 2. /dashboard/
  function parseDashboard(text) {
    const t = str(text);
    const i = t.search(/Weekly progress/i);
    const wk = i >= 0 ? t.slice(i, i + 600) : '';
    const count = (word) => {
      if (!wk) return null;
      if (new RegExp('No ' + word + 's? yet', 'i').test(wk)) return 0;
      return m1(wk, new RegExp('(\\d+)\\s*' + word + 's?\\b', 'i'));
    };
    return {
      postImpressions7d: m1(t, /([\d,]+)\s*Post impressions/i),
      followers: m1(t, /([\d,]+)\s*Total followers/i),
      profileViewers90d: m1(t, /([\d,]+)\s*Profile viewers/i),
      searchAppearances: m1(t, /([\d,]+)\s*Search appearances/i),
      postsThisWeek: count('post'),
      commentsThisWeek: count('comment'),
    };
  }

  // 3. /analytics/creator/content/?timeRange=past_90_days
  function parseContent(text) {
    const t = str(text);
    const after = (label) => m1(t, new RegExp(label + '\\s*:?\\s*([\\d,]+)', 'i'));
    const ch = /([-−]?\s*[\d,.]+)\s*%\s*vs\.?\s*prior/i.exec(t);
    return {
      impressions: m1(t, /([\d,]+)\s*Impressions\b/i),
      impressionsChangePct: ch ? num(ch[1].replace('−', '-')) : null,
      engagements: after('Social engagements'),
      reactions: after('Reactions'),
      comments: after('Comments'),
      reposts: after('Reposts'),
      saves: after('Saves'),
    };
  }

  // Age text ("today", "yesterday", "3 days", "1 week") -> { key, days }
  const UNIT_DAYS = { day: 1, week: 7, month: 30, year: 365 };
  function ageKey(s) {
    const t = String(s || '').toLowerCase().trim();
    if (t === 'today' || /hours?|minutes?|seconds?/.test(t)) return { key: '0d', days: 0 };
    if (t === 'yesterday') return { key: '1d', days: 1 };
    const m = /^(\d+)\s*(day|week|month|year)s?/.exec(t);
    if (!m) return null;
    const n = +m[1];
    return { key: n + m[2][0], days: n * UNIT_DAYS[m[2]] };
  }

  // 4. /mynetwork/invitation-manager/sent/ — counts by age only, no names.
  function parseInvitations(text) {
    const t = str(text);
    const ageCounts = {};
    let rowsRead = 0;
    const re = /\bSent\s+(today|yesterday|\d+\s*(?:second|minute|hour|day|week|month|year)s?\s+ago)/gi;
    let m;
    while ((m = re.exec(t))) {
      const a = ageKey(m[1].replace(/\s+ago$/i, ''));
      if (!a) continue;
      ageCounts[a.key] = (ageCounts[a.key] || 0) + 1;
      rowsRead++;
    }
    let total = m1(t, /\bPeople\s*\(?\s*([\d,]+)\s*\)?/i);
    if (total == null && /No pending invitations|You have no sent invitations/i.test(t)) total = 0;
    return { total, rowsRead, ageCounts };
  }
  function countSentRows(text) { return parseInvitations(text).rowsRead; }

  const SYSTEM_LISTS = /^(Description\b|Recommended Leads|Recently Accepted Connections|New Executives at Saved Accounts|Saved on LinkedIn\.com|Recommended Accounts)/i;

  // Table rows "name | count | M/D/YYYY". Rows are recognised line by line; a row may be
  // one tab-separated line or split over a few lines. Names are only used to flag system lists
  // and are never returned.
  function parseListRows(text) {
    const lines = str(text).split(/\n/).map((l) => l.trim());
    const rows = [];
    let start = 0;
    for (let i = 0; i < lines.length; i++) {
      const dm = /(\d{1,2}\/\d{1,2}\/\d{4})\s*$/.exec(lines[i]);
      if (!dm) continue;
      const updated = usDate(dm[1]);
      // cells: same line split by tabs / pipes, else previous lines
      let cells = lines[i].slice(0, dm.index).split(/\t|\s\|\s/).map((c) => c.trim()).filter(Boolean);
      let j = i - 1;
      while (cells.length < 2 && j >= start && j >= i - 4) {
        if (lines[j]) cells.unshift(lines[j]);
        j--;
      }
      let count = null;
      if (cells.length) {
        const last = cells[cells.length - 1];
        if (/^[\d,]+$/.test(last)) { count = num(last); cells.pop(); }
        else {
          const cm = /\s([\d,]+)$/.exec(last);
          if (cm) { count = num(cm[1]); cells[cells.length - 1] = last.slice(0, cm.index); }
        }
      }
      const first = cells[0] || '';
      rows.push({ count, updated, system: SYSTEM_LISTS.test(first) });
      start = i + 1;
    }
    return rows;
  }

  // 5. /sales/lists/people
  function parseLeadLists(text) {
    const t = str(text);
    return { total: m1(t, /All saved leads\s*\(\s*([\d,]+)\s*\)/i), rows: parseListRows(t) };
  }

  // 6. /sales/lists/company
  function parseAccountLists(text) {
    const t = str(text);
    return {
      total: m1(t, /(?:Search in saved accounts|All saved accounts)\s*\(\s*([\d,]+)\s*\)/i),
      rows: parseListRows(t),
    };
  }

  // 7. Saved searches dialog. editButtons = number of buttons whose aria-label starts "Edit ".
  function parseSavedSearches(text, editButtons) {
    const t = str(text);
    const newResults = [];
    const re = /([\d,]+)\s*new results?\s*since\s*(\d{1,2}\/\d{1,2}\/\d{4})/gi;
    let m;
    while ((m = re.exec(t))) newResults.push({ count: num(m[1]), since: usDate(m[2]) });
    let count = Number.isInteger(editButtons) && editButtons > 0 ? editButtons : null;
    if (count == null && newResults.length) count = newResults.length;
    if (count == null && /no saved searches|haven.t saved any searches/i.test(t)) count = 0;
    return { count, newResults };
  }

  // 8. /sales/inbox
  function parseInbox(text) {
    return { inmailLeft: m1(str(text), /InMail credits\s*:?\s*([\d,]+)\s*left/i) };
  }

  // Page state: 'ok' | 'signed_out' | 'no_sales_nav'
  function detectPageState(url, text, page) {
    const u = String(url || '');
    const t = str(text);
    let path = '';
    try { path = new URL(u).pathname; } catch (e) { path = u; }
    if (/^\/(login|uas\/login|authwall|checkpoint|signup|start\/join)/i.test(path)) return 'signed_out';
    if (/\bSign in\b/.test(t) && /\bJoin now\b/.test(t) && t.length < 6000 && !/\bMe\b|My Network/.test(t)) return 'signed_out';
    const salesPage = /^(ssi|leadLists|accountLists|savedSearches|inbox)$/.test(page || '');
    if (salesPage && page !== 'ssi') {
      if (path && !/^\/sales\//.test(path)) return 'no_sales_nav';
      if (/(start|try)[^.\n]{0,40}free trial|upgrade to Sales Navigator|don.t have access to Sales Navigator|Sales Navigator (seat|contract) (has )?expired/i.test(t)) return 'no_sales_nav';
    }
    return 'ok';
  }

  // Readiness: true once real content (not skeleton rows) is on the page.
  const ready = {
    ssi: (t) => /out of\s*100/i.test(t) && /Build relationships/i.test(t),
    dashboard: (t) => /Total followers|Post impressions/i.test(t),
    content: (t) => /Impressions/i.test(t) && /Social engagements/i.test(t),
    invitations: (t) => /\bSent\s+(today|yesterday|\d+)/i.test(t) || /No pending invitations|You have no sent invitations/i.test(t),
    leadLists: (t) => /All saved leads\s*\(\s*\d/i.test(t) && /\d{1,2}\/\d{1,2}\/\d{4}/.test(t),
    accountLists: (t) => /(Search in saved accounts|All saved accounts)\s*\(\s*\d/i.test(t) && /\d{1,2}\/\d{1,2}\/\d{4}/.test(t),
    savedSearches: (t) => /new results? since|no saved searches/i.test(t),
    inbox: (t) => /InMail credits/i.test(t),
  };

  const api = {
    parseSsi, parseDashboard, parseContent, parseInvitations, parseLeadLists, parseAccountLists,
    parseSavedSearches, parseInbox, detectPageState, countSentRows, ageKey, usDate, ready,
  };
  globalThis.GaugeParsers = Object.freeze(api);
})();
