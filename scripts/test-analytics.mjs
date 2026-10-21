import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./analytics-snapshot.js', import.meta.url), 'utf8');
const run = new Function('$input', 'Date', source);
const instant = '2026-09-08T18:26:00.000Z';
class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [instant])); } }
const payload = { syncedAt: instant, tradingDate: '2026-09-08', sourceDates: { 'mutual-funds': '2026-09-07' }, rowsByVariation: {
  '52wh': ['publish', 'draft', 'processing', 'failed'].map(status => ({ status, trading_date: '2026-09-08' })),
  'mutual-funds': [{ status: 'Published', trading_date: '2026-09-07' }],
  'seo-draft-blogs': [{ status: 'Published', trading_date: '2026-09-08', title: 'SEO draft blog' }],
  'seo-auto-publish': [{ status: 'Published', trading_date: '2026-09-08', title: 'SEO auto-published blog' }],
  'gift-nifty-market-update': [{ status: 'Published', trading_date: '2026-09-08' }],
} };
const evaluate = value => run({ first: () => ({ json: value }) }, FixedDate)[0].json;
const snapshot = evaluate(payload);
assert.equal(snapshot.report_date, '2026-09-08');
assert.equal(snapshot.snapshot_kind, 'end-of-day');
const rows = JSON.parse(snapshot.payload);
assert.equal(rows.length, 25);
assert.equal(rows.find(row => row.id === 'gift-nifty-market-update').published, 1);
assert.equal(rows.find(row => row.id === '52wh').total, 4);
assert.equal(rows.find(row => row.id === 'mutual-funds').total, 0);
assert.equal(rows.find(row => row.id === 'seo-draft-blogs').published, 1);
assert.equal(rows.find(row => row.id === 'seo-auto-publish').published, 1);
assert.equal(rows.find(row => row.id === 'sector-updates').total, 0);
for (const row of rows) assert.equal(row.total, row.published + row.drafts + row.processing + row.failed);
assert.throws(() => evaluate({ ...payload, warning: 'Unavailable' }));
assert.throws(() => evaluate({ ...payload, syncedAt: '2026-09-07T18:26:00Z' }));
assert.throws(() => evaluate({ ...payload, rowsByVariation: { '52wh': [{ status: 'unexpected', trading_date: '2026-09-08' }] } }));
console.log('Passed: 25 variations, status reconciliation, IST cutoff, stale-source filtering, category separation and failure rejection.');
