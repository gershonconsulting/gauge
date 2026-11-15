// The pages Gauge reads, in order. Pure data so it can be unit-tested.
export const STEPS = [
  { page: 'ssi', label: 'Social Selling Index', url: 'https://www.linkedin.com/sales/ssi', salesNav: false },
  { page: 'dashboard', label: 'Your LinkedIn dashboard', url: 'https://www.linkedin.com/dashboard/', salesNav: false },
  { page: 'content', label: 'Content analytics (90 days)', url: 'https://www.linkedin.com/analytics/creator/content/?timeRange=past_90_days', salesNav: false },
  { page: 'invitations', label: 'Pending invitations', url: 'https://www.linkedin.com/mynetwork/invitation-manager/sent/', salesNav: false },
  { page: 'leadLists', label: 'Sales Navigator lead lists', url: 'https://www.linkedin.com/sales/lists/people', salesNav: true },
  { page: 'accountLists', label: 'Sales Navigator account lists', url: 'https://www.linkedin.com/sales/lists/company', salesNav: true },
  { page: 'savedSearches', label: 'Sales Navigator saved searches', url: 'https://www.linkedin.com/sales/search/people', salesNav: true, optional: true },
  { page: 'inbox', label: 'Sales Navigator InMail credits', url: 'https://www.linkedin.com/sales/inbox', salesNav: true },
];

export const REASONS = {
  signed_out: 'You are not signed in to LinkedIn',
  no_sales_nav: 'No Sales Navigator seat on this account',
  timeout: 'The page did not finish loading in time',
  error: 'The page could not be read',
  cancelled: 'Cancelled before this page was read',
  skipped: 'Skipped',
};

// What could not be read, given per-page outcomes { page: { state, data } }.
export function unreadableList(pages) {
  const out = [];
  for (const s of STEPS) {
    const r = pages[s.page];
    if (!r) { out.push({ page: s.page, label: s.label, reason: REASONS.skipped }); continue; }
    if (r.state !== 'ok') out.push({ page: s.page, label: s.label, reason: REASONS[r.state] || REASONS.error });
    else if (r.data && Object.values(r.data).every((v) => v == null)) out.push({ page: s.page, label: s.label, reason: 'No numbers found on the page' });
  }
  return out;
}

// Signals for scoring: only pages that returned data (timeouts may carry partial numbers).
export function signalsFrom(pages) {
  const sig = {};
  for (const [k, r] of Object.entries(pages)) if (r && r.data) sig[k] = r.data;
  return sig;
}
