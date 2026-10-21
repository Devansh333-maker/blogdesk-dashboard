// Manual, read-only reporting export. Never refreshes sources or deploys code.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const day = process.argv[2];
assert.match(day || '', /^\d{4}-\d{2}-\d{2}$/, 'Pass a backup date as YYYY-MM-DD.');
const root = path.resolve('data-backups', day);
const base = 'https://univest-blog.f20230280119222.chatgpt.site';
const recentFrom = new Date(Date.parse(day + 'T00:00:00Z') - 179 * 86400000).toISOString().slice(0, 10);
const historyFrom = `${Number(day.slice(0, 4)) - 9}-01-01`;
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function assertSafe(value) {
  const text = JSON.stringify(value);
  assert(!/sk-(?:proj-|admin-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|-----BEGIN .*PRIVATE KEY|Bearer\s+[A-Za-z0-9._-]{20,}/i.test(text), 'Potential credential found; refusing export.');
  assert(!/https?:[^\s"\\]*\/webhook(?:-test)?\//i.test(text), 'Webhook endpoint found; refusing export.');
  function visit(v) {
    if (!v || typeof v !== 'object') return;
    for (const [key, child] of Object.entries(v)) {
      assert(!/^(authorization|api_?key|password|secret|ciphertext|cookie|csrf_?token|session_?id|access_?token|refresh_?token)$/i.test(key), 'Sensitive field found; refusing export.');
      visit(child);
    }
  }
  visit(value);
}

async function get(api) {
  const response = await fetch(base + api, { signal: AbortSignal.timeout(100000) });
  if (!response.ok) throw Error(`Reporting export failed with HTTP ${response.status}.`);
  const body = await response.json();
  assertSafe(body);
  assert(!hasOwn(body, 'error'), 'Source reported an error.');
  return body;
}

const [analytics, costs, efficiency] = await Promise.all([
  get(`/api/analytics?from=${historyFrom}&to=${day}`),
  get(`/api/openai/cost-analysis?from=${recentFrom}&to=${day}`),
  get(`/api/efficiency?from=${recentFrom}&to=${day}`),
]);
assert(Array.isArray(analytics.snapshots) && analytics.snapshots.length, 'No blog history returned.');
assert(costs.report && costs.savedAtByDate && Array.isArray(costs.report.dailyUsage), 'Missing saved cost report.');
assert(Array.isArray(efficiency.days), 'Missing efficiency report.');

const countKeys = ['published', 'drafts', 'processing', 'failed', 'total'];
const splitKeys = ['fresh', 'updated', 'unclassified'];
const quality = [];
const blogRows = [];
for (const s of analytics.snapshots) {
  assert.match(s.date, /^\d{4}-\d{2}-\d{2}$/);
  assert(s.date <= day && Array.isArray(s.variations));
  for (const v of s.variations) {
    for (const k of countKeys) assert(Number.isInteger(v[k]) && v[k] >= 0, `Invalid ${k} count.`);
    if (v.published + v.drafts + v.processing + v.failed !== v.total) quality.push({ date: s.date, variation: v.id, issue: 'Stored status counts do not sum to stored total; preserved unchanged.' });
    blogRows.push([s.date, s.capturedAt, s.kind, v.group, v.id, v.name, ...countKeys.map(k => v[k]), ...splitKeys.map(k => v[k] ?? null)]);
  }
}

const inventory = JSON.parse(await fs.readFile(path.join(root, 'database-inventory.json'), 'utf8'));
const summaryDates = inventory.tables.blog_daily_summaries.map(r => r.date);
const costDates = Object.keys(costs.savedAtByDate).sort();
const blogDates = [...new Set(analytics.snapshots.map(s => s.date))].sort();
assert(summaryDates.every(d => blogDates.includes(d)), 'Some D1 blog dates are missing from the reporting response.');
assert.deepEqual(costDates, inventory.tables.cost_daily_snapshots.map(r => r.date).sort(), 'Cost export does not cover the inventoried D1 dates.');

const files = [];
async function save(name, content) {
  const bytes = Buffer.from(content);
  await fs.writeFile(path.join(root, name), bytes, { flag: 'wx' });
  files.push({ path: name, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
}
const json = v => JSON.stringify(v, null, 2) + '\n';
function csv(rows) {
  const cell = value => {
    if (value == null) return '';
    let s = String(value);
    if (typeof value === 'string' && /^[=+@-]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s;
  };
  return '\uFEFF' + rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

await save('analytics-history.json', json(analytics));
await save('cost-history.json', json(costs));
await save('efficiency-history.json', json(efficiency));
await save('blog-variations.csv', csv([['Date (IST)', 'Captured at', 'Snapshot kind', 'Category', 'Variation ID', 'Variation', ...countKeys, ...splitKeys], ...blogRows]));

const metrics = [...new Set(costs.report.dailyUsage.flatMap(u => Object.keys(u.metrics)))].sort();
await save('usage-by-model.csv', csv([['Date (UTC)', 'Model', 'Source', 'Service tier', 'Batch', ...metrics], ...costs.report.dailyUsage.map(u => [u.date, u.model, u.source, u.serviceTier, u.batch, ...metrics.map(k => u.metrics[k] ?? null)])]));
await save('costs-daily.csv', csv([['Date (UTC)', 'Currency', 'Actual billed amount', 'Snapshot saved at', 'Coverage'], ...costDates.flatMap(date => {
  const daily = costs.report.actualBilledCosts.daily.filter(c => c.date === date);
  return daily.length ? daily.map(c => [c.date, c.currency, c.amount, costs.savedAtByDate[c.date], 'Saved billed amount']) : [[date, null, null, costs.savedAtByDate[date], 'Saved snapshot; no billed line items']];
})]));
await save('cost-line-items.csv', csv([['Date (UTC)', 'Currency', 'Actual billed amount', 'Invoice line item', 'Project ID'], ...costs.report.actualBilledCosts.dailyLineItems.map(c => [c.date, c.currency, c.amount, c.lineItem, c.projectId])]));

const allDays = [];
for (let t = Date.parse(blogDates[0] + 'T00:00:00Z'); t <= Date.parse(day + 'T00:00:00Z'); t += 86400000) allDays.push(new Date(t).toISOString().slice(0, 10));
const efficiencyDays = efficiency.days.filter(d => d.blogs || d.time || d.cost || d.creation);
await save('daily-efficiency.csv', csv([
  ['Date (blogs/time IST; costs UTC)', ...countKeys, 'Estimated minutes saved', 'Recorded creation minutes', 'Timed articles', 'Avg measured creation minutes/article', 'Actual costs by currency (JSON)', 'Cost per published article (JSON)', 'Blog snapshot kind'],
  ...efficiencyDays.map(d => [d.date, ...countKeys.map(k => d.blogs?.[k] ?? null), d.time?.minutesSaved ?? null, d.creation?.totalMinutes ?? null, d.creation?.timedArticles ?? null, d.creationMinutesPerArticle ?? null, d.cost ? JSON.stringify(d.cost.amounts) : null, d.costPerPublished ? JSON.stringify(d.costPerPublished) : null, d.blogKind]),
]));
await save('time-saved-by-category.csv', csv([['Date (IST)', 'Category', 'Estimated minutes saved', 'Successful runs', 'Estimated articles', 'Updated at'], ...efficiency.days.flatMap(d => (d.time?.breakdown || []).map(c => [d.date, c.category, c.minutesSaved, c.successfulRuns, c.estimatedArticles, d.time.updatedAt]))]));
await save('creation-time-by-category.csv', csv([['Date (IST)', 'Category', 'Recorded creation minutes', 'Timed articles', 'Updated at'], ...efficiency.days.flatMap(d => (d.creation?.breakdown || []).map(c => [d.date, c.category, c.totalMinutes, c.timedArticles, d.creation.updatedAt]))]));

// Logical reporting restore only. Do not execute against production without review.
const sqlString = s => "'" + String(s).replaceAll("'", "''") + "'";
const sql = [
  '-- Logical reporting backup; not a full database dump. See README before restoring.',
  '-- Canonical merged blog snapshots can differ from the original D1 row payloads.',
  'CREATE TABLE IF NOT EXISTS blog_daily_summaries (date TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL);',
  'CREATE TABLE IF NOT EXISTS cost_daily_snapshots (date TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL);',
];
for (const s of analytics.snapshots) sql.push(`INSERT INTO blog_daily_summaries (date,payload,updated_at) VALUES (${sqlString(s.date)},${sqlString(JSON.stringify(s))},${sqlString(s.capturedAt)}) ON CONFLICT(date) DO NOTHING;`);
for (const date of costDates) {
  const r = costs.report;
  const startTime = Date.parse(date + 'T00:00:00Z') / 1000;
  const dailyLines = r.actualBilledCosts.dailyLineItems.filter(x => x.date === date);
  const totals = new Map();
  for (const l of dailyLines) totals.set(l.currency, (totals.get(l.currency) || 0) + l.amount);
  const report = { ...r, period: { ...r.period, from: date, to: date, startTime, endTimeExclusive: startTime + 86400 }, actualBilledCosts: { ...r.actualBilledCosts, dailyLineItems: dailyLines, daily: r.actualBilledCosts.daily.filter(x => x.date === date), totalsByCurrency: [...totals].map(([currency, amount]) => ({ currency, amount })), byProject: [], byLineItem: [] }, dailyUsage: r.dailyUsage.filter(x => x.date === date), generatedAt: costs.savedAtByDate[date] };
  sql.push(`INSERT INTO cost_daily_snapshots (date,payload,updated_at) VALUES (${sqlString(date)},${sqlString(JSON.stringify(report))},${sqlString(costs.savedAtByDate[date])}) ON CONFLICT(date) DO NOTHING;`);
}
await save('restore-reporting.sql', sql.join('\n') + '\n');
const inventoryBytes = await fs.readFile(path.join(root, 'database-inventory.json'));
files.push({ path: 'database-inventory.json', bytes: inventoryBytes.length, sha256: crypto.createHash('sha256').update(inventoryBytes).digest('hex') });
const manifest = {
  formatVersion: 1, backupDate: day, capturedAt: new Date().toISOString(), sourceOrigin: base,
  backupType: 'Logical reporting export; not a complete physical database or infrastructure backup',
  requestedHistoryRange: { from: historyFrom, to: day }, requestedCostAndTimingRange: { from: recentFrom, to: day },
  coverage: {
    blogSnapshots: analytics.snapshots.length, blogVariationRows: blogRows.length, blogFirstDate: blogDates[0], blogLastDate: blogDates.at(-1),
    blogDates, missingBlogDatesSinceFirstSnapshot: allDays.filter(d => !blogDates.includes(d)),
    d1BlogDateCount: summaryDates.length, d1BlogDatesCovered: summaryDates.every(d => blogDates.includes(d)),
    costSavedDates: costDates.length, costDates, missingCostDatesSinceFirstSavedDate: costs.missingDates.filter(d => d >= costDates[0]),
    timeSavedDates: efficiency.days.filter(d => d.time).map(d => d.date),
    creationTimingDates: efficiency.days.filter(d => d.creation).map(d => d.date),
    efficiencySourceAvailability: efficiency.sources,
  },
  qualityWarnings: quality, sourceWarnings: efficiency.warnings,
  exclusions: ['API keys and credentials', 'Authentication/session/rate-limit tables', 'Runtime environment values', 'WordPress article bodies', 'Raw n8n executions/tables and source Google Sheets', 'Browser-local to-do items', 'Uncaptured or unavailable historical records'],
  caveats: ['Today is a partial-day capture.', 'Blogs and timing use IST; Costs API billing dates use UTC.', 'Fresh/updated classification may be unavailable for older dates.', 'This is a manual point-in-time backup; no automatic future backup is configured.', 'Sources are read sequentially/in parallel and are not a transactionally consistent database snapshot.', 'Logical SQL reconstructs canonical report payloads, not byte-identical source rows.'],
  files,
};
assertSafe(manifest);
await fs.writeFile(path.join(root, 'manifest.json'), json(manifest), { flag: 'wx' });
console.log(JSON.stringify({ backupDate: day, ...manifest.coverage, qualityWarnings: quality.length, sourceWarnings: efficiency.warnings, files: files.length + 1 }, null, 2));
