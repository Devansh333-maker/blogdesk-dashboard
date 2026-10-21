import { env } from 'cloudflare:workers';
import type { CostAnalysis } from './openai-costs';
import { combineCostReports, dateList } from './cost-report';
const db=()=>{const binding=(env as unknown as {DB?:D1Database}).DB;if(!binding)throw Error('Cost storage unavailable');return binding;};
export async function savedCostReport(from:string,to:string){
  const {results}=await db().prepare('SELECT date,payload,updated_at FROM cost_daily_snapshots WHERE date >= ? AND date <= ? ORDER BY date').bind(from,to).all<{date:string;payload:string;updated_at:string}>();
  const dates=new Set(results.map(r=>r.date));
  return {report:combineCostReports(results.map(r=>JSON.parse(r.payload) as CostAnalysis),from,to),savedAtByDate:Object.fromEntries(results.map(r=>[r.date,r.updated_at])),missingDates:dateList(from,to).filter(d=>!dates.has(d))};
}
export async function saveCostReport(report:CostAnalysis){
  if(report.actualBilledCosts.status!=='ready'||report.usageByModel.status!=='ready')throw Error('Incomplete report');
  await db().batch(dateList(report.period.from,report.period.to).map(date=>db().prepare('INSERT INTO cost_daily_snapshots (date,payload,updated_at) VALUES (?,?,?) ON CONFLICT(date) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at WHERE excluded.updated_at >= cost_daily_snapshots.updated_at').bind(date,JSON.stringify(combineCostReports([report],date,date)),report.generatedAt)));
}
