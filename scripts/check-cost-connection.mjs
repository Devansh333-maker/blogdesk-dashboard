import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(new URL('../lib/openai-costs.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const api = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const report = await api.getOpenAICostAnalysis(api.parseCostDateRange(process.argv[2], process.argv[3]));
console.log(JSON.stringify({costStatus:report.actualBilledCosts.status,usageStatus:report.usageByModel.status,currencies:report.actualBilledCosts.totalsByCurrency.map(r=>r.currency),days:report.actualBilledCosts.daily.length,models:report.usageByModel.models.length,projects:report.actualBilledCosts.byProject.length,warnings:report.warnings}));
