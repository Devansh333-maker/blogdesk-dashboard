'use client';
import { useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { CostAnalysis } from '@/lib/openai-costs';

const metrics = ['num_model_requests','input_tokens','output_tokens','input_cached_tokens','input_cache_write_tokens','input_uncached_tokens','input_text_tokens','output_text_tokens','input_cached_text_tokens','input_audio_tokens','input_cached_audio_tokens','output_audio_tokens','input_image_tokens','input_cached_image_tokens','output_image_tokens'];
const label = (key: string) => key === 'num_model_requests' ? 'Requests' : key.replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
export default function CostUsageDetails({ rows, from, to }: { rows: CostAnalysis['dailyUsage']; from: string; to: string }) {
  const [model,setModel]=useState('all');
  const filtered=rows.filter(r=>r.source==='completions'&&(model==='all'||r.model===model));
  const columns=metrics.filter(k=>filtered.some(r=>r.metrics[k]!==null));
  const models=[...new Set(rows.filter(r=>r.source==='completions').map(r=>r.model))].sort();
  const number=(n:number|null|undefined)=>n==null?'—':n.toLocaleString('en-US');
  function download(){
    const records=[['Date (UTC)','Model','Service tier','Batch',...metrics],...filtered.map(r=>[r.date,r.model,r.serviceTier??'',r.batch??'',...metrics.map(k=>r.metrics[k]??'')])];
    const csv=records.map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n');
    const url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download=`blog-news-automation-usage-${from}-${to}.csv`;a.click();URL.revokeObjectURL(url);
  }
  return <section className="report-panel report-section">
    <div className="report-section-head"><div><h2 className="text-base font-bold">Daily usage details</h2><p className="mt-1 text-xs text-muted-foreground">Responses and Chat Completions · blog-news-automation · UTC</p></div><div className="flex min-w-0 flex-wrap items-end gap-2"><label className="grid min-w-0 gap-1 text-[11px] font-semibold text-muted-foreground">Model<select aria-label="Usage model" value={model} onChange={e=>setModel(e.target.value)} className="h-9 w-full max-w-64 rounded-lg border bg-white px-3 text-xs text-foreground"><option value="all">All models</option>{models.map(m=><option key={m}>{m}</option>)}</select></label><Button variant="outline" disabled={!filtered.length} onClick={download}><Download size={16}/>Download usage CSV</Button></div></div>
    <div tabIndex={0} role="region" aria-label="Usage token details — scroll for all fields" className="report-table-scroll max-h-[480px]"><table className="usage-detail-table w-full text-sm tabular-nums"><thead className="sticky top-0 z-10 bg-[#214f72] text-white"><tr>{['Date (UTC)','Model','Service tier','Batch',...columns.map(label)].map(c=><th key={c} className={`min-w-32 whitespace-nowrap px-4 py-3 text-left ${c==='Date (UTC)'?'sticky left-0 z-20':c==='Model'?'sticky left-32 z-20':''}`}>{c}</th>)}</tr></thead><tbody>{filtered.map((r,i)=><tr key={i} className="border-b border-slate-100 hover:bg-slate-50"><td className="sticky left-0 z-2 min-w-32 whitespace-nowrap bg-white px-4 py-3">{r.date}</td><td className="sticky left-32 z-2 whitespace-nowrap bg-white px-4 py-3 font-medium">{r.model}</td><td className="px-4 py-3">{r.serviceTier??'—'}</td><td className="px-4 py-3">{r.batch===null?'—':r.batch?'Yes':'No'}</td>{columns.map(k=><td key={k} className="px-4 py-3 text-right">{number(r.metrics[k])}</td>)}</tr>)}</tbody></table>{!filtered.length&&<p className="p-8 text-center text-slate-500">No completion usage rows returned for this selection.</p>}</div>
    <p className="report-footnote">Input tokens include cached and cache-write tokens; those columns are breakdowns, not additional tokens. Missing fields show “—”. This live report follows your CSV’s usage fields without importing or double-counting the downloaded snapshot.</p>
  </section>;
}
