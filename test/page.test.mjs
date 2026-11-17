import { test } from 'node:test';
import assert from 'node:assert/strict';

test('company Page: visitor count only, admin id from links', async () => {
  const { parsePageVisitors, adminPageId } = await import('../extension/page-parsers.js');
  assert.deepEqual(parsePageVisitors('Visitor highlights\nPage views\n312\nUnique visitors\n40\nLast 30 days'), { visitors30d: 40 });
  assert.deepEqual(parsePageVisitors('40\nPage visitors\nVisitor view limits vary by plan'), { visitors30d: 40 });
  assert.equal(parsePageVisitors('Business Development Specialist at Agile Falcon'), null);
  assert.equal(adminPageId(['/in/someone/', '/company/acme/', 'https://www.linkedin.com/company/12345678/admin/dashboard/']), '12345678');
  assert.equal(adminPageId(['/company/acme/']), null);
  const bg = (await import('node:fs')).readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
  assert.ok(bg.includes('read: readCompanyPage') && bg.includes('/admin/analytics/visitors/'));
  assert.ok(bg.includes('consentVersion >= 3'));
  assert.ok(!/visitors?\s*names?\b.*return/i.test(bg));
});
