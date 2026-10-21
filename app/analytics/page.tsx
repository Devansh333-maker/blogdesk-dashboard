'use client';

import { useEffect, useMemo, useState } from 'react';
import { BarChart3, RefreshCw } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button } from '@/components/ui/button';
import {ReportNavigation} from '@/components/report-navigation';
import {PublicationBreakdown} from '@/components/publication-breakdown';

type Counts = { published: number; fresh:number; updated:number; unclassified:number; drafts: number; processing: number; failed: number; total: number };
type Variation = Counts & { id: string; name: string; group: string; sourceDate?: string };
type Snapshot = { date: string; capturedAt: string; kind: string; variations: Variation[] };
type History = { snapshots: Snapshot[]; historyStartsOn: string | null; publicationBackfill?: {from:string;to:string;unavailableFrom:string;unavailableTo:string} };
const metrics = ['published','fresh','updated','unclassified', 'drafts', 'processing', 'failed', 'total'] as const;
const labels = { published: 'Published',fresh:'Fresh',updated:'Updated on same URL',unclassified:'Unclassified', drafts: 'Drafts', processing: 'Processing', failed: 'Failed', total: 'Total blogs' };
const empty = (): Counts => ({ published: 0,fresh:0,updated:0,unclassified:0, drafts: 0, processing: 0, failed: 0, total: 0 });
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const shift = (date: string, days: number) => new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10);
const shortDate = (date: string) => new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' }).format(new Date(date));
const captureTime = (date: string) => new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(date));
const variationName = (item: Pick<Variation, 'id' | 'name'>) => item.id === 'results-preview' ? 'Results Preview and others' : item.name;

export default function AnalyticsPage() {
  const [range, setRange] = useState({ from: shift(today(), -6), to: today() });
  const [draft, setDraft] = useState(range);
  const [preset, setPreset] = useState('7');
  const [category, setCategory] = useState('all');
  const [history, setHistory] = useState<History | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true); setError(''); setHistory(null);
    fetch(`/api/analytics?from=${range.from}&to=${range.to}`, { cache: 'no-store', signal: abort.signal })
      .then(async response => { const data = await response.json() as History & { error?: string }; if (!response.ok) throw new Error(data.error); return data; })
      .then(data => setHistory(data))
      .catch(reason => { if (reason.name !== 'AbortError') setError(reason.message || 'Unable to load history.'); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [range, refresh]);
  const snapshots = history?.snapshots || [];
  const categories = useMemo(() => {
    const map = new Map<string, Variation>();
    for (const snapshot of snapshots) for (const item of snapshot.variations) map.set(item.id, item);
    return [...map.values()];
  }, [history]);
  const summaries = useMemo(() => categories.filter(item => category === 'all' || item.id === category).map(item => {
    const sum = { ...item, ...empty() };
    for (const snapshot of snapshots) {
      const row = snapshot.variations.find(v => v.id === item.id);
      if (row) for (const metric of metrics) sum[metric] += row[metric];
    }
    return sum;
  }), [categories, category, history]);
  const totals = summaries.reduce((sum, item) => { for (const metric of metrics) sum[metric] += item[metric]; return sum; }, empty());
  const daily = useMemo(() => {
    const map = new Map(snapshots.map(snapshot => [snapshot.date, snapshot]));
    const rows = [];
    for (let date = range.from; date <= range.to && rows.length < 3661; date = shift(date, 1)) {
      const snapshot = map.get(date);
      const sum = snapshot ? snapshot.variations.filter(v => category === 'all' || v.id === category).reduce((result, row) => {
        for (const metric of metrics) result[metric] += row[metric]; return result;
      }, empty()) : null;
      rows.push({ date, label: shortDate(date), snapshot, ...sum });
    }
    return rows;
  }, [history, category, range]);
  const dailyVariations = useMemo(() => [...snapshots].reverse().flatMap(snapshot => {
    const variations = snapshot.variations.filter(item => category === 'all' || item.id === category);
    return variations.map((item, index) => ({ snapshot, item, firstForDate: index === 0, rowsForDate: variations.length }));
  }), [snapshots, category]);
  function choosePreset(days: number) {
    const next = { from: shift(today(), 1 - days), to: today() };
    setDraft(next); setRange(next); setPreset(String(days));
  }
  function chooseMonth() {
    const next={from:today().slice(0,7)+'-01',to:today()};
    setDraft(next);setRange(next);setPreset('month');
  }
  return <main className="report-page">
    <div className="report-container">
      <ReportNavigation active="analytics"/>
      <div className="report-heading">
        <div><div className="flex items-center gap-3"><BarChart3 className="text-[#7667ff]" /><h1 className="text-3xl font-bold tracking-tight">Blog analytics</h1></div><p>Daily counts by variation · Saved automatically at 11:55 PM IST.</p></div>
        <Button variant="outline" disabled={loading} onClick={() => setRefresh(v => v + 1)}><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh history</Button>
      </div>
      <section className="report-panel report-toolbar" aria-label="Analytics filters">
        <div className="flex flex-wrap gap-2">{[3, 7].map(days => <Button key={days} variant={preset === String(days) ? 'default' : 'outline'} onClick={() => choosePreset(days)}>Last {days} days</Button>)}<Button variant={preset === 'month' ? 'default' : 'outline'} onClick={chooseMonth}>This month</Button><Button variant={preset === 'custom' ? 'default' : 'outline'} onClick={() => setPreset('custom')}>Custom dates</Button></div>
        {preset === 'custom' && <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); if (draft.from && draft.to && draft.from <= draft.to) setRange({ ...draft }); }}>
          <label className="grid gap-1 text-sm font-medium">From<input required type="date" max={draft.to || today()} value={draft.from} onChange={event => setDraft(v => ({ ...v, from: event.target.value }))} className="h-10 rounded-lg border bg-white px-2" /></label>
          <label className="grid gap-1 text-sm font-medium">To<input required type="date" min={draft.from} max={today()} value={draft.to} onChange={event => setDraft(v => ({ ...v, to: event.target.value }))} className="h-10 rounded-lg border bg-white px-2" /></label><Button type="submit">Apply</Button>
        </form>}
        <label className="report-select">Blog variation<select aria-label="Blog variation" value={category} onChange={event => setCategory(event.target.value)} className="h-10 max-w-full rounded-lg border bg-white px-3"><option value="all">All variations</option>{categories.map(item => <option key={item.id} value={item.id}>{item.group} — {variationName(item)}</option>)}</select></label>
      </section>
      <p className="report-meta">{range.from} to {range.to} · IST · Presets include today.{history?.historyStartsOn && ` History starts ${history.historyStartsOn}.`}</p>
      {loading ? <div role="status" className="report-note mt-4 py-10 text-center text-muted-foreground">Loading saved history…</div> : error ? <div role="alert" className="my-8 rounded-xl border border-red-200 bg-red-50 p-5 text-red-800">{error}</div> : <>
        <div className="report-note mt-3"><strong>{snapshots.length} of {daily.length} days have a snapshot.</strong> {daily.length > snapshots.length && 'Missing days are excluded from totals.'} {snapshots.some(s => s.kind !== 'end-of-day') && 'Partial-day snapshots are included and labelled below.'}</div>
        <section aria-label="Period totals" className="report-metrics">{(['total', 'published', 'drafts', 'processing', 'failed'] as const).map(metric => <div key={metric} className="report-metric"><p className="text-sm text-muted-foreground">{labels[metric]}</p><strong className="mt-2 block text-3xl">{snapshots.length ? totals[metric].toLocaleString() : '—'}</strong></div>)}</section>
        <section className="report-panel mt-3 p-3.5"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-xs font-bold">Published breakdown</h2><PublicationBreakdown counts={totals}/></div><details className="mt-2 text-xs text-muted-foreground"><summary className="cursor-pointer font-semibold">Source & counting notes</summary><p className="mt-2 leading-relaxed">Splits come from article-level feed records and WordPress publication timestamps. Original history and status totals are unchanged.</p></details>{history?.publicationBackfill && range.from<='2026-10-15' && range.to>='2026-10-01' && <p className="mt-2 rounded-lg bg-muted/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground">October backfill: 9–15 Oct is reconstructed from retained daily feed runs. 1–8 Oct article-level runs are no longer available; those published counts remain Unclassified, not zero. Today uses the latest dashboard sync.</p>}</section>
        {snapshots.length > 0 ? <>
          <section className="report-panel report-section p-4"><h2 className="text-base font-bold">Daily blog counts</h2><p className="mt-1 text-xs text-muted-foreground">Counts as captured each day · missing dates have no bar</p><div className="mt-3 flex flex-wrap gap-4 text-xs">{[['Published','#159f8c'],['Drafts','#7667ff'],['Processing','#f08a5d'],['Failed','#e06969']].map(([label,color]) => <span key={label} className="flex items-center gap-2"><span className="size-3 rounded-sm" style={{ background:color }} />{label}</span>)}</div><div className="mt-3 h-56 w-full"><ResponsiveContainer width="100%" height="100%"><BarChart data={daily}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" tick={{ fontSize: 12 }} /><YAxis allowDecimals={false} tick={{ fontSize: 12 }} /><Tooltip labelFormatter={(_, values) => values[0]?.payload?.date || ''} /><Bar dataKey="published" name="Published" stackId="blogs" fill="#159f8c" /><Bar dataKey="drafts" name="Drafts" stackId="blogs" fill="#7667ff" /><Bar dataKey="processing" name="Processing" stackId="blogs" fill="#f08a5d" /><Bar dataKey="failed" name="Failed" stackId="blogs" fill="#e06969" /></BarChart></ResponsiveContainer></div></section>
          <section className="report-section"><h2 className="text-base font-bold">Daily counts by variation</h2><p className="mt-1 text-xs text-muted-foreground">Article status for every blog variation on each saved day. Use the Blog variation filter above to focus on one type.</p><div tabIndex={0} role="region" aria-label="Daily variation counts — scroll for all columns" className="report-table-scroll mt-3 max-h-[540px] rounded-xl border bg-white"><table className="daily-variation-table w-full min-w-[1100px] text-sm"><thead className="sticky top-0 z-10 bg-muted"><tr><th className="table-anchor date-anchor p-3 text-left">Date</th><th className="table-anchor variation-anchor p-3 text-left">Blog variation</th><th className="p-3 text-right">Published</th><th className="p-3 text-right">Fresh</th><th className="p-3 text-right">Updated</th><th className="p-3 text-right">Unclassified</th><th className="p-3 text-right">Drafts</th><th className="p-3 text-right">Processing</th><th className="p-3 text-right">Failed</th><th className="p-3 text-right">Total blogs</th></tr></thead><tbody>{dailyVariations.map(({ snapshot, item, firstForDate, rowsForDate }) => <tr key={`${snapshot.date}-${item.id}`} className="border-t hover:bg-muted/30">{firstForDate && <th rowSpan={rowsForDate} className="table-anchor date-anchor whitespace-nowrap border-r p-3 text-left align-top font-semibold"><span>{snapshot.date}</span><span className={`mt-1 block text-xs font-medium ${snapshot.kind === 'end-of-day' ? 'text-[#16806f]' : 'text-[#a65f3f]'}`}>{snapshot.kind === 'end-of-day' ? 'End of day' : 'Partial day'}</span></th>}<th className="table-anchor variation-anchor p-3 text-left font-medium">{variationName(item)}<span className="mt-0.5 block text-xs font-normal text-muted-foreground">{item.group}</span></th><td className="p-3 text-right tabular-nums text-[#16806f]">{item.published.toLocaleString()}</td><td className="p-3 text-right tabular-nums">{item.fresh.toLocaleString()}</td><td className="p-3 text-right tabular-nums">{item.updated.toLocaleString()}</td><td className="p-3 text-right tabular-nums">{item.unclassified.toLocaleString()}</td><td className="p-3 text-right tabular-nums text-[#6555c9]">{item.drafts.toLocaleString()}</td><td className="p-3 text-right tabular-nums text-[#c96d43]">{item.processing.toLocaleString()}</td><td className="p-3 text-right tabular-nums text-[#c84f4f]">{item.failed.toLocaleString()}</td><td className="p-3 text-right font-semibold tabular-nums">{item.total.toLocaleString()}</td></tr>)}</tbody></table></div></section>
          <section className="report-section"><h2 className="text-base font-bold">Totals by variation</h2><p className="mt-1 text-xs text-muted-foreground">Sum of saved daily counts in the selected period.</p><div tabIndex={0} role="region" aria-label="Totals by variation — scroll for all columns" className="report-table-scroll mt-3 rounded-xl border bg-white"><table className="w-full min-w-[980px] text-sm"><thead className="bg-muted/60"><tr><th className="p-3 text-left">Blog variation</th>{metrics.map(metric => <th key={metric} className="p-3 text-right">{labels[metric]}</th>)}</tr></thead><tbody>{summaries.map(item => <tr key={item.id} className="border-t hover:bg-muted/30"><th className="table-anchor p-3 text-left font-medium">{variationName(item)}<span className="mt-0.5 block text-xs font-normal text-muted-foreground">{item.group}</span></th>{metrics.map(metric => <td key={metric} className="p-3 text-right tabular-nums">{item[metric].toLocaleString()}</td>)}</tr>)}</tbody><tfoot className="border-t bg-muted/60 font-bold"><tr><th className="p-3 text-left">Total</th>{metrics.map(metric => <td key={metric} className="p-3 text-right">{totals[metric].toLocaleString()}</td>)}</tr></tfoot></table></div></section>
        </> : <div className="mt-6 rounded-xl border bg-white p-10 text-center"><h2 className="text-base font-bold">No snapshots in this date range</h2><p className="mt-2 text-muted-foreground">Choose a more recent date range. Daily history accumulates from the first capture.</p></div>}
        <section className="report-section"><h2 className="text-base font-bold">Day-by-day details</h2><div tabIndex={0} role="region" aria-label="Day-by-day details — scroll for all columns" className="report-table-scroll mt-3 max-h-[480px] rounded-xl border bg-white"><table className="w-full min-w-[980px] text-sm"><thead className="sticky top-0 bg-muted"><tr><th className="p-3 text-left">Date</th><th className="p-3 text-left">Snapshot</th>{metrics.map(metric => <th key={metric} className="p-3 text-right">{labels[metric]}</th>)}</tr></thead><tbody>{daily.map(day => <tr key={day.date} className="border-t"><th className="whitespace-nowrap p-3 text-left font-medium">{day.date}</th><td className="p-3">{day.snapshot ? <><span className={day.snapshot.kind === 'end-of-day' ? 'text-[#16806f]' : 'text-[#a65f3f]'}>{day.snapshot.kind === 'end-of-day' ? 'End of day' : 'Partial day'}</span><span className="block whitespace-nowrap text-xs text-muted-foreground">{captureTime(day.snapshot.capturedAt)} IST</span></> : <span className="text-muted-foreground">No snapshot</span>}</td>{metrics.map(metric => <td key={metric} className="p-3 text-right tabular-nums">{day.snapshot ? day[metric]?.toLocaleString() : '—'}</td>)}</tr>)}</tbody></table></div></section>
        <p className="report-meta mt-4">Published = Fresh + Updated + Unclassified. Total blogs = Published + Drafts + Processing + Failed. Each date retains its captured statuses, including when posts are published manually on a later day.</p>
      </>}
    </div>
  </main>;
}
