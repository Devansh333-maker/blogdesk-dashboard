'use client';
import { useEffect, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import {ReportNavigation} from '@/components/report-navigation';
import { Button } from '@/components/ui/button';
import CostDailyReport from '@/components/cost-daily-report';
import CostUsageDetails from '@/components/cost-usage-details';
import type { CostAnalysis } from '@/lib/openai-costs';
import { downloadCostExcel } from '@/lib/cost-report';

type Saved={report:CostAnalysis|null;missingDates:string[];savedAtByDate?:Record<string,string>};
const shift=(d:string,n:number)=>new Date(Date.parse(d+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
async function request(from:string,to:string,refresh=false,sync=false):Promise<Saved>{
  const response=await fetch(`/api/openai/cost-analysis?from=${from}&to=${to}${sync?'&mode=sync':''}`,{method:refresh?'POST':'GET',headers:refresh?{'Content-Type':'application/json'}:undefined,body:refresh?'{}':undefined,cache:'no-store'});
  const value=await response.json() as Saved & {error?:string};if(!response.ok)throw Error(value.error||'Report unavailable.');return value;
}
export default function CostAnalysisPage(){
  const [today,setToday]=useState(()=>new Date().toISOString().slice(0,10));
  const [saved,setSaved]=useState<Saved|null>(null);
  const [busy,setBusy]=useState(true);const [error,setError]=useState('');
  const [exportBusy,setExportBusy]=useState(false);const [exportError,setExportError]=useState('');
  const [from,setFrom]=useState(today);const [to,setTo]=useState(today);
  useEffect(()=>{let active=true;setBusy(true);request(shift(today,-6),today).then(r=>{if(active)setSaved(r);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setBusy(false);});return()=>{active=false;};},[today]);
  async function sync(){setBusy(true);setError('');try{const now=new Date().toISOString().slice(0,10);const r=await request(shift(now,-6),now,true,true);setToday(now);setSaved(r);}catch(e){setError(e instanceof Error?e.message:'Sync failed.');}finally{setBusy(false);}}
  async function download(){setExportBusy(true);setExportError('');try{const r=await request(from,to,true);if(!r.report||r.missingDates.length)throw Error('The selected report is incomplete. Please try again.');downloadCostExcel(r.report);}catch(e){setExportError(e instanceof Error?e.message:'Download failed.');}finally{setExportBusy(false);}}
  const report=saved?.report;
  const hasToday=!!saved&&!saved.missingDates.includes(today)&&!!report;
  const rows=report?.dailyUsage.filter(r=>r.date===today)??[];
  const sum=(key:string)=>rows.reduce((n,r)=>n+(r.metrics[key]??0),0);
  const costs=report?.actualBilledCosts.daily.filter(r=>r.date===today)??[];
  const cost=costs.length?costs.map(r=>new Intl.NumberFormat('en-US',{style:'currency',currency:r.currency,maximumFractionDigits:4}).format(r.amount)).join(' · '):'0 (no reported charges)';
  return <div className="report-page"><div className="report-container">
    <ReportNavigation active="cost"/>
    <main>
      <div className="report-heading"><div><div className="report-kicker">blog-news-automation · Public report</div><h1>Today’s API costs</h1><p>{today} · UTC · Saved report. Sync only when you need an update.</p></div><Button onClick={sync} disabled={busy||exportBusy}><RefreshCw aria-hidden="true" size={16} className={busy?'animate-spin':''}/>{busy?'Loading…':'Sync now'}</Button></div>
      {error&&<p role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">{error} Saved data has not been replaced.</p>}
      {!busy&&!hasToday&&<p className="mt-5 rounded-xl border bg-white p-4 text-slate-600">No saved report for today yet. Click Sync now to load it. Missing data is not shown as zero.</p>}
      <section className="report-metrics four" aria-label="Today's API usage">{[['Actual cost today',hasToday?cost:'—'],['Model requests',hasToday?sum('num_model_requests').toLocaleString():'—'],['Input tokens',hasToday?sum('input_tokens').toLocaleString():'—'],['Output tokens',hasToday?sum('output_tokens').toLocaleString():'—']].map(([label,value])=><div key={label} className="report-metric"><p>{label}</p><strong>{value}</strong></div>)}</section>
      <details className="report-disclosure"><summary>Download detailed Excel · optional date range</summary><div className="disclosure-content"><div className="report-toolbar !px-0 !pt-0"><label>From<input type="date" value={from} max={to} onChange={e=>setFrom(e.target.value)}/></label><label>To<input type="date" value={to} min={from} max={today} onChange={e=>setTo(e.target.value)}/></label><Button onClick={download} disabled={busy||exportBusy||!from||!to||from>to}><Download aria-hidden="true" size={16}/>{exportBusy?'Preparing Excel…':'Download Excel'}</Button></div><p>Daily models, requests, token breakdowns, and actual model charges for the selected dates. Billing labels without matching usage stay separate.</p>{exportError&&<p role="alert" className="mt-2 text-red-700">{exportError}</p>}</div></details>
      {saved&&saved.missingDates.length>0&&<p className="mt-5 text-sm text-amber-800">Saved cost history is missing {saved.missingDates.length} day(s) in this week. Sync now will load the missing days.</p>}
      {busy&&!report?<div role="status" className="report-note mt-4 py-6 text-center text-muted-foreground">Loading saved cost and usage history…</div>:<><CostDailyReport from={shift(today,-6)} to={today} lines={report?.actualBilledCosts.dailyLineItems??[]} available={!!report} projects={[]} /><CostUsageDetails from={today} to={today} rows={rows}/></>}
      {report&&<p className="report-meta mt-4">Today last synced: {saved?.savedAtByDate?.[today]?new Date(saved.savedAtByDate[today]).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})+' IST':'not synced yet'}. Today is incomplete; OpenAI may report charges later. Billing days use UTC.</p>}
    </main>
  </div></div>;
}
