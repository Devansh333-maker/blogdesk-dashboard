import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

const day = process.argv[2];
assert.match(day || '', /^\d{4}-\d{2}-\d{2}$/);
const root = path.resolve('data-backups', day);
const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
for (const file of manifest.files) {
  assert.equal(path.basename(file.path), file.path, 'Manifest paths must remain inside the dated backup.');
  const bytes = await fs.readFile(path.join(root, file.path));
  assert.equal(bytes.length, file.bytes, `Length mismatch: ${file.path}`);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), file.sha256, `Checksum mismatch: ${file.path}`);
}
const read = async name => JSON.parse(await fs.readFile(path.join(root, name), 'utf8'));
const analytics = await read('analytics-history.json');
const costs = await read('cost-history.json');
const efficiency = await read('efficiency-history.json');
const db = new DatabaseSync(':memory:');
db.exec(await fs.readFile(path.join(root, 'restore-reporting.sql'), 'utf8'));
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM blog_daily_summaries').get().n, analytics.snapshots.length);
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cost_daily_snapshots').get().n, Object.keys(costs.savedAtByDate).length);
for (const snapshot of analytics.snapshots) {
  const restored = db.prepare('SELECT payload FROM blog_daily_summaries WHERE date=?').get(snapshot.date);
  assert.deepEqual(JSON.parse(restored.payload), snapshot, 'Restored blog payload differs.');
}
const restoredUsage = [];
const restoredLines = [];
for (const date of Object.keys(costs.savedAtByDate).sort()) {
  const row = db.prepare('SELECT payload,updated_at FROM cost_daily_snapshots WHERE date=?').get(date);
  const report = JSON.parse(row.payload);
  assert.equal(row.updated_at, costs.savedAtByDate[date]);
  assert.equal(report.period.from, date);
  assert.equal(report.period.to, date);
  assert.deepEqual(report.dailyUsage, costs.report.dailyUsage.filter(u => u.date === date));
  assert.deepEqual(report.actualBilledCosts.dailyLineItems, costs.report.actualBilledCosts.dailyLineItems.filter(l => l.date === date));
  restoredUsage.push(...report.dailyUsage);
  restoredLines.push(...report.actualBilledCosts.dailyLineItems);
}
assert.equal(restoredUsage.length, costs.report.dailyUsage.length);
assert.equal(restoredLines.length, costs.report.actualBilledCosts.dailyLineItems.length);
const amounts = new Map();
for (const line of restoredLines) amounts.set(line.currency, (amounts.get(line.currency) || 0) + line.amount);
for (const total of costs.report.actualBilledCosts.totalsByCurrency) assert(Math.abs((amounts.get(total.currency) || 0) - total.amount) < 1e-8, 'Restored currency total mismatch.');
// Restore is idempotent and cannot overwrite a pre-existing row.
db.exec(await fs.readFile(path.join(root, 'restore-reporting.sql'), 'utf8'));
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM blog_daily_summaries').get().n, analytics.snapshots.length);
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cost_daily_snapshots').get().n, Object.keys(costs.savedAtByDate).length);
db.close();

function parseCsv(source) {
  const out = []; let row = [], cell = '', quoted = false;
  const text = source.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && c === ',') { row.push(cell); cell = ''; }
    else if (!quoted && c === '\n') { row.push(cell.replace(/\r$/, '')); out.push(row); row = []; cell = ''; }
    else cell += c;
  }
  assert(!quoted, 'Unclosed CSV field.');
  if (cell || row.length) { row.push(cell); out.push(row); }
  return out;
}
for (const file of manifest.files.filter(f => f.path.endsWith('.csv'))) {
  const rows = parseCsv(await fs.readFile(path.join(root, file.path), 'utf8'));
  assert(rows.length > 0 && rows.every(r => r.length === rows[0].length), `CSV column mismatch: ${file.path}`);
  if (file.path === 'blog-variations.csv') {
    assert.equal(rows.length - 1, manifest.coverage.blogVariationRows);
    for (const r of rows.slice(1)) assert.equal(Number(r[6]) + Number(r[7]) + Number(r[8]) + Number(r[9]), Number(r[10]));
  }
  if (file.path === 'usage-by-model.csv') assert.equal(rows.length - 1, costs.report.dailyUsage.length);
}
assert.equal(manifest.coverage.blogSnapshots, analytics.snapshots.length);
assert.equal(manifest.coverage.costSavedDates, Object.keys(costs.savedAtByDate).length);
assert.deepEqual(manifest.coverage.timeSavedDates, efficiency.days.filter(d => d.time).map(d => d.date));
assert.deepEqual(manifest.coverage.creationTimingDates, efficiency.days.filter(d => d.creation).map(d => d.date));
console.log(JSON.stringify({ result: 'PASS', verifiedFiles: manifest.files.length, restoredBlogDays: analytics.snapshots.length, restoredCostDays: Object.keys(costs.savedAtByDate).length, restoredUsageRows: restoredUsage.length, restoredCostLines: restoredLines.length, timeSavedDays: manifest.coverage.timeSavedDates.length, creationTimingDays: manifest.coverage.creationTimingDates.length, missingCostDates: manifest.coverage.missingCostDatesSinceFirstSavedDate }, null, 2));
