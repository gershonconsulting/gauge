// Gauge — readers for the company Page a user administers (counts only).
import { numberAfter, numberBefore } from './parsers.js';

// Company Page admin: linkedin.com/company/<id>/admin/analytics/visitors/ (and the Premium Page
// "Page visitors" panel). Only the number of visitors over the last 30 days is kept; the names and
// job titles of visitors are never read or returned.
export function parsePageVisitors(text) {
  const t = String(text || '');
  const v =
    numberAfter(t, 'unique visitors', 30) ??
    numberBefore(t, 'unique visitors', 30) ??
    numberBefore(t, 'page visitors', 20);
  return v == null ? null : { visitors30d: v };
}

// The numeric id of the first company Page the user administers, from links like
// "/company/12345678/admin/". Only the id is used, to open that Page's own analytics.
export function adminPageId(hrefs) {
  for (const h of hrefs || []) {
    const m = String(h).match(/\/company\/(\d+)\/admin\b/);
    if (m) return m[1];
  }
  return null;
}
