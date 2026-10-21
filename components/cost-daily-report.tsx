'use client';

import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';

type Line = { date: string; currency: string; amount: number; lineItem: string | null; projectId: string | null };
type Props = { from: string; to: string; lines: Line[]; available: boolean; projects: { projectId: string | null; projectName: string | null }[] };
// Attribution uses only explicit model names on invoice lines, never Usage API estimates.
export function billingColumn(line: string | null) {
  return line?.match(/^((?:gpt-|chatgpt-|text-embedding-|dall-e-|whisper-|tts-|o[134](?:-|$))[^\s,]*)/i)?.[1] || 'Other charges';
}
const money = (n: number, currency: string, digits = 4) => currency === 'unknown' ? `${n.toFixed(digits)} (currency unavailable)` : new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase(), minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
const short = (date: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));

export default function CostDailyReport({ from, to, lines, available, projects }: Props) {
  const [project, setProject] = useState('all');
  const [chosenCurrency, setCurrency] = useState('');
  const currencies = [...new Set(lines.map(row => row.currency))].sort();
  const currency = currencies.includes(chosenCurrency) ? chosenCurrency : currencies[0] || 'usd';
  const filtered = useMemo(() => lines.filter(row => row.currency === currency && (project === 'all' || (row.projectId || 'unattributed') === project)), [lines, currency, project]);
  const columns = [...new Set(filtered.map(row => billingColumn(row.lineItem)))].sort((a,b) => a === 'Other charges' ? 1 : b === 'Other charges' ? -1 : a.localeCompare(b));
  const dates: string[] = [];
  for (let date = from; date <= to && dates.length < 180; date = new Date(Date.parse(date) + 86400000).toISOString().slice(0,10)) dates.push(date);
  const daily = dates.map(date => {
    const rows = filtered.filter(row => row.date === date);
    const cells = Object.fromEntries(columns.map(column => [column, rows.filter(row => billingColumn(row.lineItem) === column).reduce((sum,row) => sum+row.amount,0)]));
    return { date, label: short(date), cells, amount: rows.length ? rows.reduce((sum,row) => sum+row.amount,0) : null };
  });
  const total = filtered.reduce((sum,row) => sum+row.amount,0);
  const peak = Math.max(0,...daily.map(row=>row.amount||0));
  const observed = daily.filter(row=>row.amount!==null);
  function download() {
    const quote = (value: string | number) => `"${String(value).replaceAll('"','""')}"`;
    const data = [
      ['Daily actual billed costs', from, to, currency.toUpperCase(), 'UTC'],
      ['Model attribution from invoice line-item labels; Other charges retained; not usage-based estimates.'],
      ['Date',...columns,'Daily total'],
      ...daily.map(row=>[row.date,...columns.map(c=>row.amount===null?'':row.cells[c]),row.amount??'']),
      ['Total',...columns.map(c=>daily.reduce((s,row)=>s+row.cells[c],0)),total],
    ].map(row=>row.map(quote).join(',')).join('\r\n');
    const url=URL.createObjectURL(new Blob(['\uFEFF'+data],{type:'text/csv;charset=utf-8'}));
    const link=document.createElement('a'); link.href=url;link.download=`OpenAI-daily-costs-${from}-to-${to}-${currency}.csv`;link.click();URL.revokeObjectURL(url);
  }
  return <section className="report-section space-y-4" aria-label="Daily cost analysis">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <p className="text-xs text-muted-foreground">{from} – {to} · UTC · Today may be incomplete</p>
      <div className="flex flex-wrap gap-3">
        {projects.length>1&&<label className="grid gap-1 text-sm font-medium">Cost project<select className="h-10 max-w-60 rounded-lg border bg-white px-3" value={project} onChange={e=>setProject(e.target.value)}><option value="all">All reported projects</option>{projects.filter((p,i,a)=>a.findIndex(x=>x.projectId===p.projectId)===i).map(p=><option key={p.projectId||'unattributed'} value={p.projectId||'unattributed'}>{p.projectName||p.projectId||'Unattributed'}</option>)}</select></label>}
        {currencies.length>1&&<label className="grid gap-1 text-sm font-medium">Currency<select className="h-10 rounded-lg border bg-white px-3" value={currency} onChange={e=>setCurrency(e.target.value)}>{currencies.map(c=><option key={c}>{c}</option>)}</select></label>}
      </div>
    </div>
    <div className="report-panel grid lg:grid-cols-[minmax(0,1fr)_210px]">
      <div className="min-w-0 p-4"><p className="text-sm font-semibold text-slate-600">Total spend · last 7 days <span className="ml-2 rounded-md bg-violet-50 px-2 py-1 text-xs text-violet-700">Actual · {currency.toUpperCase()}</span></p><strong className="mt-2 block text-3xl font-bold tracking-tight tabular-nums">{available&&observed.length?money(total,currency,2):'—'}</strong>
        {!available?<p className="py-12 text-center text-red-700">Costs are unavailable. Refresh to try again.</p>:!observed.length?<p className="py-12 text-center text-slate-500">No billed cost rows returned for these filters.</p>:<div className="mt-3 h-52 w-full"><ResponsiveContainer width="100%" height="100%"><BarChart data={daily} margin={{left:0,right:8,top:10,bottom:0}}><CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#e7e5ee"/><XAxis dataKey="label" tick={{fontSize:12}} axisLine={false} tickLine={false} minTickGap={24}/><YAxis tick={{fontSize:12}} axisLine={false} tickLine={false} width={48}/><Tooltip labelFormatter={(_,items)=>items[0]?.payload?.date+' UTC'} formatter={value=>[money(Number(value),currency),'Actual spend']} cursor={{fill:'#f4f2f8'}}/><Bar dataKey="amount" fill="#8955db" radius={[3,3,0,0]} maxBarSize={70}/></BarChart></ResponsiveContainer></div>}
      </div>
      <div className="grid content-start gap-4 border-t bg-slate-50/50 p-4 sm:grid-cols-2 lg:grid-cols-1 lg:border-l lg:border-t-0"><div><p className="text-xs text-muted-foreground">Highest daily spend</p><strong className="mt-2 block text-2xl">{available&&observed.length?money(peak,currency,2):'—'}</strong></div><div><p className="text-xs text-muted-foreground">Model columns</p><strong className="mt-2 block text-2xl">{columns.filter(c=>c!=='Other charges').length}</strong><p className="mt-1 text-[11px] text-muted-foreground">Identified from invoice labels</p></div><p className="text-[11px] leading-relaxed text-muted-foreground">Billing dates use UTC, matching the OpenAI usage view. Charges may arrive after usage.</p></div>
    </div>
    <div className="report-panel">
      <div className="report-section-head"><div><h2 className="text-base font-bold">Daily cost by model</h2><p className="mt-1 text-xs text-muted-foreground">Actual invoice charges grouped by model label · {currency.toUpperCase()} · not token-price estimates</p></div><Button variant="outline" onClick={download} disabled={!available||!observed.length}><Download size={16}/>Download CSV</Button></div>
      <div tabIndex={0} role="region" aria-label="Daily cost by model — scroll for all models" className="report-table-scroll max-h-[480px]"><table className="w-full border-collapse text-sm tabular-nums"><thead className="sticky top-0 z-20 bg-[#214f72] text-white"><tr><th className="sticky left-0 z-20 min-w-28 bg-[#214f72] px-4 py-3 text-left">Date</th>{columns.map(c=><th key={c} className="min-w-40 border-l border-white/15 px-3 py-3 text-center font-semibold">{c}</th>)}<th className="sticky right-0 min-w-36 bg-[#214f72] px-4 py-3 text-right">Daily total</th></tr></thead><tbody>{daily.map(row=><tr key={row.date} className="border-b border-slate-100 hover:bg-slate-50"><th className="sticky left-0 z-10 bg-white px-4 py-2.5 text-left font-medium">{short(row.date)}</th>{columns.map(c=><td key={c} className="whitespace-nowrap px-3 py-2.5 text-right">{row.amount===null||row.cells[c]===0?'—':money(row.cells[c],currency)}</td>)}<td className="sticky right-0 bg-[#d9efc8] px-4 py-2.5 text-right font-semibold">{available&&row.amount!==null?money(row.amount,currency):'—'}</td></tr>)}</tbody><tfoot className="sticky bottom-0 z-20 bg-[#eae5fa] font-bold"><tr><th className="sticky left-0 bg-[#eae5fa] px-4 py-3 text-left">Total</th>{columns.map(c=><td key={c} className="px-3 py-3 text-right">{money(daily.reduce((sum,row)=>sum+row.cells[c],0),currency)}</td>)}<td className="sticky right-0 bg-[#c6e4b2] px-4 py-3 text-right">{available&&observed.length?money(total,currency):'—'}</td></tr></tfoot></table></div>
      <p className="report-footnote">“—” means no reported charge. Other charges includes tools and unrecognized invoice labels. Scroll sideways to see every model. Today’s usage details below are separate from this seven-day cost view.</p>
    </div>
  </section>;
}
