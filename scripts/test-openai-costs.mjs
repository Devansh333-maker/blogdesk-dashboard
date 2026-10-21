import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(new URL('../lib/openai-costs.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const api = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
process.env.N8N_OPENAI_COSTS_WEBHOOK_URL = 'https://example.invalid/report';
let calls = [];
globalThis.fetch = async (url, options) => {
  assert.equal(url, process.env.N8N_OPENAI_COSTS_WEBHOOK_URL);
  const input = JSON.parse(options.body);
  const u = new URL('https://api.openai.com/v1/' + input.resource);
  u.search = new URLSearchParams(input.parameters).toString(); calls.push(u);
  if (u.pathname.endsWith('/projects')) return new Response('{}', { status: 403 });
  const start = Number(u.searchParams.get('start_time'));
  const result = u.pathname.endsWith('/costs')
    ? { amount: { value: 1.25, currency: 'usd' }, project_id: 'project-test', line_item: 'tokens' }
    : { model: 'test-model', input_tokens: 10, output_tokens: 5, num_model_requests: 2 };
  return Response.json({ data: [{ start_time: start, end_time: start + 86400, results: [result] }], has_more: false });
};
const result = await api.getOpenAICostAnalysis(api.parseCostDateRange('2026-09-01', '2026-09-02'));
assert.deepEqual(calls[0].searchParams.getAll('group_by[]'), ['line_item']);
assert.equal(result.actualBilledCosts.totalsByCurrency[0].amount, 1.25);
assert.equal(result.actualBilledCosts.status, 'ready');
assert.equal(result.actualBilledCosts.dailyLineItems.length, 1);
assert.equal(result.actualBilledCosts.dailyLineItems[0].date, '2026-09-01');
assert.equal(result.actualBilledCosts.dailyLineItems.reduce((sum, row) => sum + row.amount, 0), result.actualBilledCosts.totalsByCurrency[0].amount);
assert.equal(result.modelCostEstimates.included, false);
assert.equal(result.usageByModel.models[0].totalTokens, 105);
assert.equal(result.actualBilledCosts.byProject[0].projectName, null);
globalThis.fetch = async () => new Response('{}', { status: 401 });
await assert.rejects(api.getOpenAICostAnalysis(api.parseCostDateRange('2026-09-01', '2026-09-02')), (error) => error.code === 'auth');
console.log('PASS: verification, query arrays, cost/usage separation, optional project access, authentication errors');
