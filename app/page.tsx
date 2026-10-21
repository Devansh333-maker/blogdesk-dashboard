'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, ArrowRight, BarChart3, BookOpen, Check, CheckCircle2, CircleDot,
  CircleDollarSign, ClipboardList, Clock3, Download, ExternalLink, LayoutDashboard, Plus, RefreshCw, Search,
  ChevronDown, Trash2, TrendingDown, TrendingUp, X, XCircle, Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {PublicationBreakdown} from '@/components/publication-breakdown';
import {publicationSplit, publicationLabel, type PublicationFields, type PublicationKind} from '@/lib/publication-split';

type BlogRecord = {
  title: string;
  company?: string;
  symbol?: string;
  status: string;
  time: string;
  url?: string;
  step?: string;
  publishedAt?: string;
  progress?: string;
  workflow?: string;
  publicationKind?: PublicationKind;
  firstPublishedAt?: string;
  lastModifiedAt?: string;
};

type Variation = PublicationFields & {
  id: string;
  name: string;
  group: string;
  total: number;
  published: number;
  drafts?: number;
  processing: number;
  failed?: number;
  helper: string;
  color: string;
  records: BlogRecord[];
  source?: string;
  sourceTableId?: string;
  sourceConnected?: boolean;
  dataDate?: string;
};

type N8nRow = Record<string, unknown>;
type SyncPayload = {
  variations?: Variation[];
  rowsByVariation?: Record<string, N8nRow[]>;
  syncedAt?: string;
  tradingDate?: string;
  sourceDates?: Record<string, string | null>;
  warning?: string;
};

const todayInIndia = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

const displayDate = (value: string) => {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(Date.UTC(year, month - 1, day)));
};

const displaySyncDateTime = (value: string) => new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
  timeZoneName: 'short',
}).format(new Date(value));

const escapeXml = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;');

const normalizeStatus = (status: string) => {
  const value = String(status ?? '').trim().toLowerCase();
  if (['publish', 'published', 'published_verified', 'updated'].includes(value)) return 'Published';
  if (['draft', 'pending', 'future', 'private'].includes(value)) return 'Draft';
  if (['processing', 'running', 'locked'].includes(value)) return 'Processing';
  if (['failed', 'error'].includes(value)) return 'Failed';
  return status || 'Queued';
};

function normalizeVariation(item: Variation): Variation {
  const records = (item.records ?? []).map((record) => ({ ...record, status: normalizeStatus(record.status) }));
  const publishedFromRecords = records.filter((record) => record.status === 'Published').length;
  const draftsFromRecords = records.filter((record) => record.status === 'Draft').length;
  const processingFromRecords = records.filter((record) => record.status === 'Processing').length;
  const failedFromRecords = records.filter((record) => record.status === 'Failed').length;
  return {
    ...item,
    records,
    published: typeof item.published === 'number' ? item.published : publishedFromRecords,
    drafts: typeof item.drafts === 'number' ? item.drafts : draftsFromRecords,
    processing: typeof item.processing === 'number' ? item.processing : processingFromRecords,
    failed: typeof item.failed === 'number' ? item.failed : failedFromRecords,
    ...publicationSplit({published:typeof item.published==='number'?item.published:publishedFromRecords,fresh:item.fresh,updated:item.updated}),
  };
}

const rowText = (row: N8nRow, ...keys: string[]) => {
  for (const key of keys) if (row[key] !== undefined && row[key] !== null) return String(row[key]);
  return '';
};

function recordFromRow(row: N8nRow, variation: Variation, index: number): BlogRecord {
  const company = rowText(row, 'company_name', 'company');
  const symbol = rowText(row, 'symbol');
  const publishedAt = rowText(row, 'published_at', 'completed_at', 'generated_at', 'locked_at');
  const title = rowText(row, 'title') || [company || symbol || variation.name, variation.name].filter(Boolean).join(' · ');
  return {
    title: title || `${variation.name} entry ${index + 1}`,
    company: company || undefined,
    symbol: symbol || undefined,
    status: normalizeStatus(rowText(row, 'status')),
    time: publishedAt ? new Date(publishedAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '—',
    publishedAt: publishedAt || undefined,
    url: rowText(row, 'post_url', 'url') || undefined,
    step: rowText(row, 'current_step', 'failure_stage') || undefined,
    progress: rowText(row, 'current_blog') && rowText(row, 'total_blogs')
      ? `${rowText(row, 'current_blog')} / ${rowText(row, 'total_blogs')}`
      : undefined,
    workflow: rowText(row, 'workflow', 'event_type') || variation.name,
    publicationKind:row.publication_kind==='fresh'?'fresh':row.publication_kind==='updated'?'updated':'unclassified',
    firstPublishedAt:rowText(row,'first_published_at')||undefined,
    lastModifiedAt:rowText(row,'last_modified_at')||undefined,
  };
}

function applySyncPayload(current: Variation[], payload: SyncPayload) {
  if (Array.isArray(payload.variations)) return payload.variations.map(normalizeVariation);
  if (!payload.rowsByVariation) return current;
  return current.map((variation) => {
    const rows = payload.rowsByVariation?.[variation.id];
    if (!rows && !variation.sourceTableId && !variation.sourceConnected) return variation;
    if (!rows) return { ...variation, total: 0, published: 0, drafts: 0, processing: 0, failed: 0, fresh:0,updated:0,unclassified:0, records: [] };
    const records = rows.map((row, index) => recordFromRow(row, variation, index)).sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
    return {
      ...variation,
      dataDate: payload.sourceDates?.[variation.id] ?? payload.tradingDate ?? variation.dataDate,
      total: records.length,
      published: records.filter((record) => record.status === 'Published').length,
      drafts: records.filter((record) => record.status === 'Draft').length,
      processing: records.filter((record) => record.status === 'Processing').length,
      failed: records.filter((record) => record.status === 'Failed').length,
      fresh:records.filter(r=>r.status==='Published'&&r.publicationKind==='fresh').length,
      updated:records.filter(r=>r.status==='Published'&&r.publicationKind==='updated').length,
      unclassified:records.filter(r=>r.status==='Published'&&r.publicationKind==='unclassified').length,
      records,
    };
  });
}

const initialVariations: Variation[] = [
  { id: 'gift-nifty-market-update', name: 'Gift Nifty Market Update', group: 'Gift Nifty Market Update', total: 0, published: 0, processing: 0, helper: 'Pre-market trade guide', color: '#247e91', source: 'Live publishing workflow', sourceConnected: true, records: [] },
  { id: 'old-url-52wh', name: '52-Week High', group: 'Old URL System', total: 0, published: 0, processing: 0, helper: '52-week highs on existing URLs', color: '#6c5ce7', source: 'Old URL System Data Table', sourceTableId: 'CuT0TFZHzlcSNNzP', records: [] },
  { id: 'old-url-52wl', name: '52-Week Low', group: 'Old URL System', total: 0, published: 0, processing: 0, helper: '52-week lows on existing URLs', color: '#8778eb', source: 'Old URL System Data Table', sourceTableId: 'CuT0TFZHzlcSNNzP', records: [] },
  { id: 'old-url-price-rise', name: 'Price Rise', group: 'Old URL System', total: 0, published: 0, processing: 0, helper: 'Price rises on existing URLs', color: '#159f8c', source: 'Old URL System Data Table', sourceTableId: 'CuT0TFZHzlcSNNzP', records: [] },
  { id: 'old-url-price-fall', name: 'Price Fall', group: 'Old URL System', total: 0, published: 0, processing: 0, helper: 'Price falls on existing URLs', color: '#e06969', source: 'Old URL System Data Table', sourceTableId: 'CuT0TFZHzlcSNNzP', records: [] },
  { id: '52wh', name: '52-Week High', group: 'System 1', total: 0, published: 0, processing: 0, helper: 'Fresh 52-week highs', color: '#6c5ce7', source: 'System 1 Data Table', sourceTableId: 'LkmkuD9B2RrwTvSI', records: [] },
  { id: '52wl', name: '52-Week Low', group: 'System 1', total: 0, published: 0, processing: 0, helper: 'Fresh 52-week lows', color: '#8778eb', source: 'System 1 Data Table', sourceTableId: 'LkmkuD9B2RrwTvSI', records: [] },
  { id: 'price-rise', name: 'Price Rise', group: 'System 1', total: 0, published: 0, processing: 0, helper: 'Price rise events', color: '#159f8c', source: 'System 1 Data Table', sourceTableId: 'LkmkuD9B2RrwTvSI', records: [] },
  { id: 'price-fall', name: 'Price Fall', group: 'System 1', total: 0, published: 0, processing: 0, helper: 'Price fall events', color: '#e06969', source: 'System 1 Data Table', sourceTableId: 'LkmkuD9B2RrwTvSI', records: [] },
  { id: 'near-52wh', name: 'Near 52-Week High', group: 'System 2', total: 0, published: 0, processing: 0, helper: 'Approaching 52-week high', color: '#f08a5d', source: 'NEAR Levels Recurrence Ledger', sourceTableId: 'KsuTRzHFztgmgJiq', records: [] },
  { id: 'near-52wl', name: 'Near 52-Week Low', group: 'System 2', total: 0, published: 0, processing: 0, helper: 'Approaching 52-week low', color: '#e69b74', source: 'NEAR Levels Recurrence Ledger', sourceTableId: 'KsuTRzHFztgmgJiq', records: [] },
  { id: 'near-ath', name: 'Near All-Time High', group: 'System 2', total: 0, published: 0, processing: 0, helper: 'Approaching all-time high', color: '#d4a62a', source: 'NEAR Levels Recurrence Ledger', sourceTableId: 'KsuTRzHFztgmgJiq', records: [] },
  { id: 'near-atl', name: 'Near All-Time Low', group: 'System 2', total: 0, published: 0, processing: 0, helper: 'Approaching all-time low', color: '#bd8d32', source: 'NEAR Levels Recurrence Ledger', sourceTableId: 'KsuTRzHFztgmgJiq', records: [] },
  { id: 'mutual-funds', name: 'Mutual Funds', group: 'Funds & Circuits', total: 0, published: 0, processing: 0, helper: 'Mutual fund articles', color: '#159f8c', source: 'Google Sheet', sourceConnected: true, records: [] },
  { id: 'upper-circuit', name: 'Upper Circuit', group: 'Funds & Circuits', total: 0, published: 0, processing: 0, helper: 'Upper circuit events', color: '#45aa8e', source: 'Circuit Blog Ledger', sourceTableId: 'bvY8WY8r46DVlwA1', records: [] },
  { id: 'lower-circuit', name: 'Lower Circuit', group: 'Funds & Circuits', total: 0, published: 0, processing: 0, helper: 'Lower circuit events', color: '#dc7069', source: 'Circuit Blog Ledger', sourceTableId: 'bvY8WY8r46DVlwA1', records: [] },
  { id: 'quarterly-results', name: 'Quarterly Results', group: 'Quarterly Results', total: 0, published: 0, processing: 0, helper: 'Company quarterly result articles', color: '#3f87c9', source: 'Quarterly Results Data Table', sourceTableId: 'PuTKR9I97MRSOBHV', records: [] },
  { id: 'opening-bell', name: 'Opening Bell', group: 'Nifty 50 Market Update', total: 0, published: 0, processing: 0, helper: 'Nifty 50 market update', color: '#4f83d1', source: 'Live publishing workflow', sourceConnected: true, records: [] },
  { id: 'midday', name: 'Midday Update', group: 'Nifty 50 Market Update', total: 0, published: 0, processing: 0, helper: 'Nifty 50 market update', color: '#6098df', source: 'Live publishing workflow', sourceConnected: true, records: [] },
  { id: 'closing-bell', name: 'Closing Bell', group: 'Nifty 50 Market Update', total: 0, published: 0, processing: 0, helper: 'Nifty 50 market update', color: '#406fae', source: 'Live publishing workflow', sourceConnected: true, records: [] },
  { id: 'top-gainers', name: 'Top 2 Gainers', group: 'Nifty Index Updates', total: 0, published: 0, processing: 0, helper: 'Two index gainers · twice daily', color: '#7667ff', source: 'Live publishing workflow', sourceConnected: true, records: [] },
  { id: 'top-losers', name: 'Top 2 Losers', group: 'Nifty Index Updates', total: 0, published: 0, processing: 0, helper: 'Two index losers · twice daily', color: '#9a6ed2', source: 'Live publishing workflow', sourceConnected: true, records: [] },
  { id: 'sector-updates', name: 'Sector Updates', group: 'Nifty Index Updates', total: 0, published: 0, processing: 0, helper: 'Four remaining indices · 4 PM', color: '#9a72d7', source: 'Live publishing workflow', sourceConnected: true, records: [] },
  { id: 'seo-draft-blogs', name: 'Draft Blogs', group: 'SEO Team Blogs', total: 0, published: 0, processing: 0, helper: 'Blogs created through the SEO draft workflows', color: '#8b5e83', source: 'SEO draft workflows', sourceConnected: true, records: [] },
  { id: 'seo-auto-publish', name: 'Auto Publish Blogs', group: 'SEO Team Blogs', total: 0, published: 0, processing: 0, helper: 'Blogs handled through the SEO auto-publish workflows', color: '#a65f3f', source: 'SEO auto-publish workflows', sourceConnected: true, records: [] },
  { id: 'seo-validate-articles', name: 'Validate Articles', group: 'SEO Team Blogs', total: 0, published: 0, processing: 0, helper: 'Articles updated and validated', color: '#247e91', source: 'SEO validation workflow', sourceConnected: true, records: [] },
];

const groups = ['System 1', 'System 2', 'Old URL System', 'Funds & Circuits', 'Quarterly Results', 'Nifty 50 Market Update', 'Gift Nifty Market Update', 'Nifty Index Updates', 'SEO Team Blogs'];

type TodoStatus = 'To do' | 'In progress' | 'Done';
type Todo = { id: number; title: string; date: string; status: TodoStatus };
const starterTodos: Todo[] = [
  { id: 1, title: 'Check System 1 failed jobs', date: '2026-09-01', status: 'In progress' },
  { id: 2, title: 'Review Midday Update output', date: '2026-09-01', status: 'To do' },
];

export default function Home() {
  const [variations, setVariations] = useState(initialVariations.map(normalizeVariation));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [publicationFilter,setPublicationFilter]=useState<'all'|PublicationKind>('all');
  const [recordQuery,setRecordQuery]=useState('');
  const detailPanelRef=useRef<HTMLElement>(null);
  const [query, setQuery] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [syncNotice, setSyncNotice] = useState('');
  const [lastSync, setLastSync] = useState('Loading…');
  const [tradingDate, setTradingDate] = useState(todayInIndia);
  const [todos, setTodos] = useState<Todo[]>(starterTodos);
  const [todosLoaded, setTodosLoaded] = useState(false);
  const [newTodo, setNewTodo] = useState('');
  const [todoDate, setTodoDate] = useState(todayInIndia);

  useEffect(()=>{
    if(!selectedId)return;
    setRecordQuery('');
    const previousFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const previousOverflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    detailPanelRef.current?.querySelector<HTMLButtonElement>('button[aria-label="Close details"]')?.focus();
    const keydown=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();setSelectedId(null);return;}
      if(event.key!=='Tab')return;
      const controls=[...(detailPanelRef.current?.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input,select,summary,[tabindex="0"]')||[])].filter(el=>el.getClientRects().length>0);
      const first=controls[0],last=controls.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    };
    document.addEventListener('keydown',keydown);
    return()=>{document.removeEventListener('keydown',keydown);document.body.style.overflow=previousOverflow;previousFocus?.focus();};
  },[selectedId]);

  useEffect(() => {
    let cancelled = false;
    const saved = window.localStorage.getItem('blogdesk-devansh-todos');
    if (saved) {
      try { setTodos(JSON.parse(saved) as Todo[]); } catch { /* Keep starter tasks. */ }
    }
    setTodosLoaded(true);

    const applyPayload = (payload: SyncPayload) => {
      if (cancelled) return;
      setVariations((current) => applySyncPayload(current, payload));
      if (payload.syncedAt) setLastSync(displaySyncDateTime(payload.syncedAt));
      if (payload.tradingDate) setTradingDate(payload.tradingDate);
      window.localStorage.setItem('blogdesk-last-live-data', JSON.stringify(payload));
    };

    const loadSavedData = () => {
      const freshPayload = window.sessionStorage.getItem('blogdesk-fresh-n8n-data');
      window.sessionStorage.removeItem('blogdesk-fresh-n8n-data');
      if (freshPayload) {
        try { applyPayload(JSON.parse(freshPayload) as SyncPayload); return; } catch { /* Fetch a clean response below. */ }
      }
      const savedPayload = window.localStorage.getItem('blogdesk-last-live-data');
      if (savedPayload) {
        try { applyPayload(JSON.parse(savedPayload) as SyncPayload); return; } catch { /* Show the manual sync state below. */ }
      }
      setLastSync('Not synced yet');
    };
    loadSavedData();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (todosLoaded) window.localStorage.setItem('blogdesk-devansh-todos', JSON.stringify(todos));
  }, [todos, todosLoaded]);

  const selected = variations.find((item) => item.id === selectedId);
  const totalBlogs = variations.reduce((sum, item) => sum + item.total, 0);
  const totalPublished = variations.reduce((sum, item) => sum + item.published, 0);
  const totalFresh=variations.reduce((sum,item)=>sum+publicationSplit(item).fresh,0);
  const totalUpdated=variations.reduce((sum,item)=>sum+publicationSplit(item).updated,0);
  const shownRecords=selected?.records.filter(r=>(publicationFilter==='all'||(r.status==='Published'&&(r.publicationKind||'unclassified')===publicationFilter))&&`${r.title} ${r.company||''} ${r.symbol||''} ${r.workflow||''}`.toLowerCase().includes(recordQuery.toLowerCase()))||[];
  const totalDrafts = variations.reduce((sum, item) => sum + (item.drafts ?? 0), 0);
  const totalProcessing = variations.reduce((sum, item) => sum + item.processing, 0);
  const totalFailed = variations.reduce((sum, item) => sum + (item.failed ?? 0), 0);
  const visibleGroups = useMemo(() => groups.map((group) => ({
    group,
    items: variations.filter((item) => item.group === group && `${item.name} ${item.helper}`.toLowerCase().includes(query.toLowerCase())),
  })).filter((section) => section.items.length), [query, variations]);

  async function syncFromN8n() {
    setSyncing(true);
    setSyncError('');
    setSyncNotice('Reading the latest entries. This may take 2–3 minutes—keep this tab open.');
    try {
      const response = await fetch(`/api/blogs?refresh=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('Could not reach n8n');
      const payload = await response.json() as SyncPayload;
      if (payload.warning) throw new Error(payload.warning);
      setVariations((current) => applySyncPayload(current, payload));
      setTradingDate(payload.tradingDate || todayInIndia());
      setLastSync(displaySyncDateTime(payload.syncedAt || new Date().toISOString()));
      window.localStorage.setItem('blogdesk-last-live-data', JSON.stringify(payload));
      setSyncNotice('Latest dashboard data loaded successfully.');
      setSyncing(false);
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : 'Unable to refresh live data. Your previous counts have been kept.');
      setSyncNotice('');
      setSyncing(false);
    }
  }

  function addTodo(event: React.FormEvent) {
    event.preventDefault();
    if (!newTodo.trim()) return;
    setTodos((current) => [...current, { id: Date.now(), title: newTodo.trim(), date: todoDate, status: 'To do' }]);
    setNewTodo('');
  }

  function updateTodo(id: number, status: TodoStatus) {
    setTodos((current) => current.map((todo) => todo.id === id ? { ...todo, status } : todo));
  }

  async function downloadExcelReport() {
    if(downloading)return;
    setDownloading(true);
    let costRows = `<Row><Cell ss:MergeAcross="8"><Data ss:Type="String">Total API Cost (${escapeXml(tradingDate)}, UTC): unavailable — not counted as zero</Data></Cell></Row>`;
    try {
      const response=await fetch(`/api/openai/cost-analysis?from=${tradingDate}&to=${tradingDate}`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
      const result=await response.json() as {report?:{actualBilledCosts:{totalsByCurrency:{currency:string;amount:number}[]}};missingDates?:string[]};
      if(response.ok && result.report && !result.missingDates?.length){
        const costs=result.report.actualBilledCosts.totalsByCurrency as {currency:string;amount:number}[];
        costRows=costs.length?costs.map(c=>`<Row><Cell ss:MergeAcross="7"><Data ss:Type="String">Total API Cost (${escapeXml(tradingDate)}, UTC, ${escapeXml(c.currency.toUpperCase())})</Data></Cell><Cell><Data ss:Type="Number">${c.amount}</Data></Cell></Row>`).join(''):`<Row><Cell ss:MergeAcross="8"><Data ss:Type="String">Total API Cost (${escapeXml(tradingDate)}, UTC): 0 — no reported charges</Data></Cell></Row>`;
      }
    }catch{/* Preserve the blog export with an explicit unavailable cost, never a false zero. */}
    const numberCell = (value: number, style = 'Number') => `<Cell ss:StyleID="${style}"><Data ss:Type="Number">${value}</Data></Cell>`;
    const rows = variations.map((item) => `<Row><Cell ss:StyleID="Label"><Data ss:Type="String">${escapeXml(item.group === 'Old URL System' ? `Old URL System — ${item.name}` : item.group === 'SEO Team Blogs' ? `SEO Team — ${item.name}` : item.group === 'Nifty 50 Market Update' ? `Nifty 50 Market Update — ${item.name}` : item.group === 'Nifty Index Updates' ? `Nifty Index Updates — ${item.name}` : item.name)}</Data></Cell>${numberCell(item.published)}${numberCell(publicationSplit(item).fresh)}${numberCell(publicationSplit(item).updated)}${numberCell(publicationSplit(item).unclassified)}${numberCell(item.drafts ?? 0)}${numberCell(item.processing)}${numberCell(item.failed ?? 0)}${numberCell(item.total)}</Row>`).join('');
    const totals = `<Row>${['TOTAL', totalPublished, totalFresh, totalUpdated, totalPublished-totalFresh-totalUpdated, totalDrafts, totalProcessing, totalFailed, totalBlogs].map((value) => typeof value === 'number' ? numberCell(value, 'Total') : `<Cell ss:StyleID="Total"><Data ss:Type="String">${value}</Data></Cell>`).join('')}</Row>`;
    const workbook = `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Center"/><Font ss:FontName="Aptos" ss:Size="11"/></Style><Style ss:ID="Title"><Font ss:FontName="Aptos Display" ss:Size="16" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#282733" ss:Pattern="Solid"/></Style><Style ss:ID="Meta"><Font ss:FontName="Aptos" ss:Size="10" ss:Color="#5F5B69"/><Interior ss:Color="#F3F1EE" ss:Pattern="Solid"/></Style><Style ss:ID="Header"><Alignment ss:Horizontal="Center"/><Font ss:FontName="Aptos" ss:Size="11" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#7667FF" ss:Pattern="Solid"/></Style><Style ss:ID="Label"><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E5E2DC"/></Borders></Style><Style ss:ID="Number"><Alignment ss:Horizontal="Center"/><NumberFormat ss:Format="#,##0"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E5E2DC"/></Borders></Style><Style ss:ID="Total"><Alignment ss:Horizontal="Center"/><Font ss:Bold="1"/><NumberFormat ss:Format="#,##0"/><Interior ss:Color="#EDEAFF" ss:Pattern="Solid"/></Style></Styles><Worksheet ss:Name="Blog Status"><Table><Column ss:Width="220"/><Column ss:Width="80" ss:Span="1"/><Column ss:Width="120"/><Column ss:Width="85" ss:Span="4"/><Row ss:Height="30"><Cell ss:MergeAcross="8" ss:StyleID="Title"><Data ss:Type="String">BlogDesk Publishing Status</Data></Cell></Row><Row ss:Height="22"><Cell ss:MergeAcross="8" ss:StyleID="Meta"><Data ss:Type="String">Report date: ${escapeXml(displayDate(tradingDate))} | Synced: ${escapeXml(lastSync)}</Data></Cell></Row><Row ss:Height="24">${['Blog Type','Published','Fresh','Updated on same URL','Unclassified','Drafts','Processing','Failed','Total Blogs'].map((label) => `<Cell ss:StyleID="Header"><Data ss:Type="String">${label}</Data></Cell>`).join('')}</Row>${rows}${totals}${costRows}</Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>3</SplitHorizontal><TopRowBottomPane>3</TopRowBottomPane><ProtectObjects>False</ProtectObjects><ProtectScenarios>False</ProtectScenarios></WorksheetOptions></Worksheet></Workbook>`;
    const blob = new Blob([`\uFEFF${workbook}`], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `blogdesk-status-${tradingDate}.xls`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setDownloading(false);
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[228px] border-r border-white/8 bg-[#15151b] text-white lg:flex lg:flex-col">
        <div className="flex h-[74px] items-center gap-3 border-b border-white/8 px-6"><div className="grid size-10 place-items-center rounded-xl bg-[#7667ff] shadow-[0_8px_24px_rgba(118,103,255,.35)]"><BookOpen className="size-[19px]" /></div><div><div className="text-base font-bold tracking-[-.025em]">BlogDesk</div><div className="text-[11px] font-semibold uppercase tracking-[.15em] text-white/45">Devansh Sureka</div></div></div>
        <nav className="flex-1 overflow-y-auto px-3 py-5" aria-label="Blog groups"><p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-[.13em] text-white/38">Blog variations</p><a href="#top" className="flex h-11 items-center gap-3 rounded-xl bg-white/10 px-3 text-sm font-semibold shadow-[inset_3px_0_0_#8173ff]"><LayoutDashboard className="size-4 text-[#a99fff]" /> All blog types</a>{groups.map((group) => <a key={group} href={`#${group.toLowerCase().replaceAll(' ','-').replace('&','and')}`} className="mt-1 flex min-h-10 items-center gap-3 rounded-xl px-3 py-2 text-xs leading-tight text-white/62 hover:bg-white/6 hover:text-white"><span className="size-1.5 shrink-0 rounded-full bg-white/25" />{group}<span className="ml-auto text-[10px] text-white/35">{variations.filter((item) => item.group === group).length}</span></a>)}<p className="mb-2 mt-5 px-3 text-[11px] font-semibold uppercase tracking-[.13em] text-white/38">Reports</p><a href="/cost-analysis" className="flex min-h-10 items-center gap-3 rounded-xl px-3 py-2 text-xs font-semibold text-white/68 hover:bg-white/6 hover:text-white"><CircleDollarSign className="size-4 text-[#65d9c4]" /> Cost Analysis<span className="ml-auto rounded-full border border-white/10 px-1.5 py-0.5 text-[8px] text-white/42">Public</span></a></nav>
        <div className="p-3"><div className="rounded-2xl border border-white/8 bg-white/[.045] p-3.5"><div className="flex items-center gap-2 text-xs font-semibold text-white/68"><Activity className="size-3.5 text-[#65d9c4]" /> n8n data tables</div><div className="mt-2 flex items-start gap-2 text-[11px] leading-relaxed text-white/42"><span className={`mt-1 size-1.5 shrink-0 rounded-full ${lastSync === 'Loading…' ? 'animate-pulse bg-[#f0a26f]' : lastSync === 'Unavailable' ? 'bg-[#e06969]' : 'bg-[#65d9c4] shadow-[0_0_8px_#65d9c4]'}`} /> {lastSync === 'Loading…' ? 'Preparing dashboard…' : lastSync === 'Not synced yet' ? 'Click Sync now to load live data' : lastSync === 'Unavailable' ? 'Live data unavailable' : `Synced ${lastSync}`}</div></div></div>
      </aside>

      <div className="lg:pl-[228px]">
        <header className="sticky top-0 z-20 flex h-[74px] items-center border-b border-border/70 bg-background/88 px-5 backdrop-blur-xl md:px-8"><div className="flex items-center gap-3 lg:hidden"><div className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground"><BookOpen className="size-4" /></div><span className="text-sm font-semibold">BlogDesk</span></div><div className="relative ml-auto hidden w-[min(32vw,360px)] md:block"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><input aria-label="Search blog variations" name="variation-search" autoComplete="off" value={query} onChange={(event) => setQuery(event.target.value)} className="h-10 w-full rounded-xl border border-border bg-white pl-9 pr-3 text-[13px] font-medium outline-none transition focus:border-[#7667ff]/60 focus:ring-3 focus:ring-[#7667ff]/10" placeholder="Search blog variation…" /></div><div className="ml-auto flex items-center gap-2 md:ml-4"><Button aria-label={downloading ? 'Preparing Excel' : 'Download Excel'} onClick={downloadExcelReport} disabled={syncing || downloading || lastSync === 'Loading…'} variant="outline" className="h-10 rounded-xl bg-white px-3 text-xs font-bold shadow-sm"><Download className="size-3.5" /><span className="hidden sm:inline">{downloading ? 'Preparing Excel…' : 'Download Excel'}</span></Button><Button onClick={syncFromN8n} disabled={syncing} className="h-10 rounded-xl bg-[#282733] px-4 text-xs font-bold text-white shadow-sm hover:bg-[#3a3848]"><RefreshCw className={`size-3.5 ${syncing ? 'animate-spin' : ''}`} />{syncing ? 'Getting latest data…' : 'Sync now'}</Button><button aria-label="Open account menu" className="ml-1 hidden size-10 place-items-center rounded-full bg-[#7667ff] text-xs font-bold text-white shadow-[0_6px_18px_rgba(118,103,255,.25)] sm:grid">DS</button></div></header>

        <main id="top" className="mx-auto max-w-[1600px] px-5 py-5 md:px-7 md:py-6">
          <div><div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-bold uppercase tracking-[.12em] text-muted-foreground"><span className="inline-flex items-center gap-2"><CircleDot className="size-3.5 text-[#159f8c]" /> Live operations · {displayDate(tradingDate)}</span>{lastSync !== 'Loading…' && lastSync !== 'Unavailable' && lastSync !== 'Not synced yet' && <span className="normal-case tracking-normal text-[#159f8c]">· Last synced {lastSync}</span>}</div><h1 className="text-[28px] font-bold leading-tight tracking-[-.04em] md:text-[32px]">Blog publishing overview</h1><p className="mt-1 text-[13px] font-medium text-muted-foreground">Today's publishing activity · Sync now checks every connected variation.</p>{syncNotice && <div role="status" className="mt-2 flex items-center gap-2 text-xs font-semibold text-[#5748bd]"><RefreshCw className={`size-3.5 shrink-0 ${syncing ? 'animate-spin' : ''}`} />{syncNotice}</div>}{syncError && <div role="alert" className="mt-3 flex max-w-2xl items-center gap-2 rounded-xl border border-[#f2c7b4] bg-[#fff4ee] px-3 py-2 text-xs font-semibold text-[#a84e2b]"><CircleDot className="size-3.5" />{syncError}</div>}</div>

          <nav aria-label="Dashboard reports" className="mt-3 flex flex-wrap gap-2"><a href="/analytics" className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-[#7667ff]/30 bg-white px-3 py-2 text-xs font-semibold text-[#6555c9] hover:bg-[#efedff] focus-visible:ring-2"><BarChart3 aria-hidden="true" className="size-3.5" /> Analytics · daily history <ArrowRight aria-hidden="true" className="size-3.5" /></a><a href="/cost-analysis" className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-[#159f8c]/30 bg-white px-3 py-2 text-xs font-semibold text-[#117565] hover:bg-[#eaf8f4] focus-visible:ring-2"><CircleDollarSign aria-hidden="true" className="size-3.5" /> OpenAI API Cost Analysis <ArrowRight aria-hidden="true" className="size-3.5" /></a><a href="/efficiency" className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-[#7667ff]/30 bg-white px-3 py-2 text-xs font-semibold text-[#6555c9] hover:bg-[#efedff] focus-visible:ring-2"><Clock3 aria-hidden="true" className="size-3.5" /> Time Saved & Efficiency <ArrowRight aria-hidden="true" className="size-3.5" /></a></nav>

          <section aria-label="Publishing summary" className="mt-4 overflow-hidden rounded-xl border bg-white">
            <div className="overview-metrics">
              {[{ label: 'Total blogs', value: totalBlogs, icon: BookOpen, tone: 'violet' }, { label: 'Published', value: totalPublished, icon: CheckCircle2, tone: 'green' }, { label: 'Drafts', value: totalDrafts, icon: ClipboardList, tone: 'violet' }, { label: 'Processing', value: totalProcessing, icon: Clock3, tone: 'orange' }, { label: 'Failed', value: totalFailed, icon: XCircle, tone: 'red' }].map((stat) => <div key={stat.label} className="overview-metric min-w-0 px-4 py-3"><div className="flex items-center gap-2"><div className={`metric-icon ${stat.tone} !size-7 !rounded-lg`}><stat.icon aria-hidden="true" className="size-3.5" /></div><p className="min-w-0 text-xs font-semibold text-muted-foreground">{stat.label}</p></div><strong className="mt-1 block text-[28px] font-bold leading-tight tracking-[-.04em] tabular-nums">{stat.value.toLocaleString()}</strong></div>)}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-[#fafbf9] px-4 py-3" aria-label="Publication types"><h2 className="text-xs font-bold">Published breakdown</h2><PublicationBreakdown counts={{published:totalPublished,fresh:totalFresh,updated:totalUpdated}} /><details className="publication-help text-xs text-muted-foreground"><summary className="cursor-pointer rounded font-semibold hover:text-foreground focus-visible:ring-2">How it's counted</summary><p className="mt-2 max-w-xl leading-relaxed">Fresh = first published on this date. Updated = previously published article refreshed on the same URL. Unclassified = evidence unavailable. These three add up to Published.</p></details></div>
          </section>

          <details className="group mt-3 rounded-xl border bg-white">
              <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-2 rounded-xl px-4 py-2 text-xs focus-visible:ring-2 [&::-webkit-details-marker]:hidden"><ClipboardList aria-hidden="true" className="size-4 text-[#7667ff]" /><h2 className="font-bold">Daily to-do</h2><span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{todos.filter(todo=>todo.status!=='Done').length} open</span><span className="ml-auto text-[10px] text-muted-foreground">Saved on this device</span><ChevronDown aria-hidden="true" className="size-4 text-muted-foreground transition-transform group-open:rotate-180" /></summary>
              <div className="border-t p-3">
                <form onSubmit={addTodo} className="flex flex-wrap gap-1.5"><input aria-label="New task" name="task" autoComplete="off" value={newTodo} onChange={(event) => setNewTodo(event.target.value)} className="h-9 min-w-0 flex-1 rounded-lg border bg-white px-3 text-[11px] outline-none focus:border-[#7667ff]/50 focus-visible:ring-2" placeholder="What needs to be done?" /><input aria-label="Task date" type="date" value={todoDate} onChange={(event) => setTodoDate(event.target.value)} className="h-9 w-[126px] rounded-lg border bg-white px-2 text-[10px]" /><Button aria-label="Add task" size="icon" type="submit" className="size-9 bg-[#7667ff] hover:bg-[#6657ee]"><Plus className="size-4" /></Button></form>
                <div className="mt-2 max-h-[88px] space-y-1.5 overflow-y-auto pr-1">{todos.length ? todos.map((todo) => <div key={todo.id} className="flex items-center gap-2 rounded-lg bg-[#faf9f7] px-2.5 py-1.5"><span className={`size-1.5 shrink-0 rounded-full ${todo.status === 'Done' ? 'bg-[#159f8c]' : todo.status === 'In progress' ? 'bg-[#f08a5d]' : 'bg-[#aaa6b1]'}`} /><span className={`min-w-0 flex-1 truncate text-[11px] font-medium ${todo.status === 'Done' ? 'text-muted-foreground line-through' : ''}`}>{todo.title}</span><span className="text-[9px] text-muted-foreground">{todo.date.slice(5)}</span><select aria-label={`Status for ${todo.title}`} value={todo.status} onChange={(event) => updateTodo(todo.id, event.target.value as TodoStatus)} className="h-7 rounded-md border bg-white px-1.5 text-[9px]"><option>To do</option><option>In progress</option><option>Done</option></select><button type="button" onClick={() => setTodos((current) => current.filter((item) => item.id !== todo.id))} aria-label={`Delete ${todo.title}`} className="text-muted-foreground hover:text-destructive"><Trash2 className="size-3.5" /></button></div>) : <p className="py-3 text-center text-[11px] text-muted-foreground">No tasks for this date.</p>}</div>
              </div>
          </details>
          <div className="mt-5 space-y-4">{visibleGroups.map(({group, items}) => <section key={group} id={group.toLowerCase().replaceAll(' ','-').replace('&','and')}><div className="mb-2 flex items-center"><h2 className="text-sm font-bold tracking-[-.015em]">{group}</h2><span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[9px] font-semibold text-muted-foreground">{items.length} variations</span></div><div className="variation-grid gap-3">{items.map((item) => { const connected = Boolean(item.sourceTableId || item.sourceConnected); return <button key={item.id} onClick={() => {setSelectedId(item.id);setPublicationFilter("all");}} className="group relative overflow-hidden rounded-xl border bg-white p-3.5 text-left shadow-[0_1px_1px_rgba(31,29,37,.02)] transition hover:-translate-y-0.5 hover:border-[#7667ff]/35 hover:shadow-[0_10px_26px_rgba(55,46,94,.09)]"><span className="absolute inset-x-0 top-0 h-0.5 opacity-65" style={{background:item.color}} /><div className="flex items-start"><div className="grid size-8 place-items-center rounded-lg" style={{background:`${item.color}18`, color:item.color}}>{item.name.toLowerCase().includes('fall') || item.name.toLowerCase().includes('low') || item.name.toLowerCase().includes('loser') ? <TrendingDown className="size-4" /> : item.name.toLowerCase().includes('circuit') ? <Zap className="size-4" /> : <TrendingUp className="size-4" />}</div><span className={`ml-auto rounded-full px-2 py-1 text-[9px] font-bold ${connected && lastSync !== 'Unavailable' ? 'bg-[#e2f5ef] text-[#16806f]' : 'bg-muted text-muted-foreground'}`}>{connected ? lastSync === 'Loading…' ? 'Loading' : item.total ? 'Live data' : 'No rows today' : 'Not connected'}</span></div><div className="mt-3 flex items-end gap-2"><div className="min-w-0 flex-1"><p className="truncate text-[13px] font-bold tracking-[-.01em]">{item.name}</p><p className="mt-0.5 truncate text-[9px] font-medium text-muted-foreground">{item.source ?? item.helper}{item.dataDate ? ` · ${displayDate(item.dataDate)}` : ''}</p></div><div className="shrink-0 text-right"><strong className="text-[25px] font-bold leading-none tracking-[-.05em]">{item.total}</strong><span className="ml-1 text-[9px] text-muted-foreground">blogs</span></div></div><div className="mt-2.5 grid grid-cols-[auto_auto_auto_auto_1fr] items-center gap-x-2 border-t pt-2.5 text-[9px] font-medium text-muted-foreground"><span><b className="text-[#16806f]">{item.published}</b> published</span><span><b className="text-[#6555c9]">{item.drafts ?? 0}</b> drafts</span><span><b className="text-[#d16b40]">{item.processing}</b> processing</span><span><b className="text-[#c34f4f]">{item.failed ?? 0}</b> failed</span><ArrowRight className="ml-auto size-3.5 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-[#7667ff]" /></div><div className="mt-2 border-t border-dashed pt-2"><PublicationBreakdown counts={item} compact /></div></button>})}</div></section>)}</div>
        </main>
      </div>

      {syncing && <div className="fixed inset-0 z-[70] grid place-items-center bg-[#17161d]/45 backdrop-blur-sm" role="status" aria-live="polite"><div className="w-[min(90vw,390px)] rounded-2xl border border-white/15 bg-white p-6 text-center shadow-[0_24px_80px_rgba(28,24,42,.28)]"><div className="mx-auto grid size-12 place-items-center rounded-2xl bg-[#efedff] text-[#6b5be0]"><RefreshCw className="size-5 animate-spin" /></div><h2 className="mt-4 text-base font-bold">Refreshing every blog status</h2><p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">Getting the latest tables, Mutual Funds sheet, and published Market Update runs. Counts, trading date, and sync time will update immediately.</p></div></div>}

      {selected && <div className="fixed inset-0 z-50 bg-[#17161d]/35 backdrop-blur-[2px]" onMouseDown={() => setSelectedId(null)}>
        <aside ref={detailPanelRef} role="dialog" aria-modal="true" aria-labelledby="article-drawer-title" tabIndex={-1} className="article-details absolute inset-y-0 right-0 w-full max-w-[720px] overflow-y-auto bg-[#f8f7f4] shadow-[-24px_0_70px_rgba(30,27,40,.18)]" onMouseDown={(event) => event.stopPropagation()}>
          <div className="sticky top-0 z-10 flex items-center border-b bg-[#f8f7f4]/95 px-6 py-4 backdrop-blur"><div><p className="text-[10px] font-bold uppercase tracking-[.14em]" style={{color:selected.color}}>{selected.group}</p><h2 id="article-drawer-title" className="mt-1 text-xl font-bold tracking-[-.035em]">{selected.name}</h2>{selected.source && <p className="mt-1 text-[10px] font-medium text-muted-foreground">Source · {selected.source}{selected.sourceTableId ? ` · ${selected.sourceTableId}` : ''}</p>}</div><button onClick={() => setSelectedId(null)} className="ml-auto grid size-9 place-items-center rounded-full border bg-white transition hover:border-[#7667ff]/40 hover:text-[#6555c9]" aria-label="Close details"><X className="size-4" /></button></div>
          <div className="p-4 sm:p-5">
            <div className="drawer-metrics">{[['Total blogs',selected.total],['Published',selected.published],['Drafts',selected.drafts ?? 0],['Processing',selected.processing],['Failed',selected.failed ?? 0]].map(([label,value]) => <div key={label} className="min-w-0 rounded-lg border bg-white p-2.5"><strong className="text-2xl font-bold tracking-[-.04em]">{value}</strong><p className="mt-1 text-[10px] font-semibold text-muted-foreground">{label}</p></div>)}</div>
            <div className="mt-3 rounded-xl border bg-white p-3"><PublicationBreakdown counts={selected} /></div><div className="mt-4 flex flex-wrap gap-2" aria-label="Filter publication type">{(["all","fresh","updated","unclassified"] as const).map(kind=><button key={kind} onClick={()=>setPublicationFilter(kind)} aria-pressed={publicationFilter===kind} className={`rounded-lg border px-3 py-1.5 text-xs ${publicationFilter===kind?"border-[#7667ff] bg-[#efedff] text-[#6555c9]":"bg-white"}`}>{kind==="all"?"All records":publicationLabel(kind)}</button>)}</div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-bold">Blog details <span className="text-xs font-medium text-muted-foreground">({shownRecords.length} shown)</span></h3><span className="text-[10px] font-medium text-muted-foreground">Synced {lastSync}</span></div><div className="relative mt-2"><Search aria-hidden="true" className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"/><input aria-label="Search articles in this variation" name="article-search" autoComplete="off" value={recordQuery} onChange={e=>setRecordQuery(e.target.value)} placeholder="Search title, company, or workflow…" className="h-10 w-full rounded-lg border bg-white pl-9 pr-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-[#7667ff]/50"/></div>
            {shownRecords.length ? <div className="mt-2 space-y-2">{shownRecords.map((record,index) => <article key={`${record.url||record.title}-${index}`} className="article-record rounded-xl border bg-white p-3.5">
              <div className="flex items-start gap-3"><div className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg ${record.status === 'Published' ? 'bg-[#e2f5ef] text-[#16806f]' : record.status === 'Draft' ? 'bg-[#efedff] text-[#6555c9]' : record.status === 'Failed' ? 'bg-[#fde9e9] text-[#c34f4f]' : 'bg-[#fff0e8] text-[#d16b40]'}`}>{record.status === 'Published' ? <Check className="size-4" /> : record.status === 'Draft' ? <ClipboardList className="size-4" /> : record.status === 'Failed' ? <XCircle className="size-4" /> : <RefreshCw className="size-4" />}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className={`text-[10px] font-bold ${record.status === 'Published' ? 'text-[#16806f]' : record.status === 'Draft' ? 'text-[#6555c9]' : record.status === 'Failed' ? 'text-[#c34f4f]' : 'text-[#d16b40]'}`}>BLOG {record.status.toUpperCase()}</span>{record.status==="Published" && <span className="rounded-full bg-[#edf3fc] px-2 py-0.5 text-[9px] font-semibold text-[#326aaf]">{publicationLabel(record.publicationKind)}</span>}{record.step && <span className="rounded-full bg-muted px-2 py-0.5 text-[9px] font-medium text-muted-foreground">{record.step}</span>}</div><h4 className="mt-2 text-sm font-bold leading-relaxed">{record.title}</h4>{record.company && <p className="mt-1 text-[10px] font-medium text-muted-foreground">{record.symbol} · {record.company}</p>}</div></div>
<div className="mt-3 flex items-center justify-between gap-3"><p className="min-w-0 truncate text-[10px] text-muted-foreground">{record.publishedAt??record.time}</p>{record.url&&<a href={record.url} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-[#4f83d1] hover:underline">{record.status==='Published'?'Open blog':'Open draft'}<ExternalLink aria-hidden="true" className="size-3"/></a>}</div><details className="mt-3 border-t pt-2.5"><summary>Publication & workflow details</summary>{record.status==="Published" && <dl className="mt-3 grid gap-3 border-t pt-3 text-[11px] sm:grid-cols-2"><div><dt className="text-[9px] font-bold uppercase text-muted-foreground">First published (WordPress)</dt><dd className="mt-1">{record.firstPublishedAt?displaySyncDateTime(record.firstPublishedAt):"Not available"}</dd></div><div><dt className="text-[9px] font-bold uppercase text-muted-foreground">Last modified (WordPress)</dt><dd className="mt-1">{record.lastModifiedAt?displaySyncDateTime(record.lastModifiedAt):"Not available"}</dd></div></dl>}<dl className="mt-3 grid gap-3 border-t pt-3 text-[11px] sm:grid-cols-2"><div><dt className="text-[9px] font-bold uppercase tracking-[.07em] text-muted-foreground">{['seo-draft-blogs', 'seo-auto-publish', 'seo-validate-articles'].includes(selected.id) && record.status !== 'Published' ? 'Draft created' : selected.id === 'seo-validate-articles' ? 'Article updated' : 'Published'}</dt><dd className="mt-1 font-medium">{record.publishedAt ?? record.time}</dd></div><div><dt className="text-[9px] font-bold uppercase tracking-[.07em] text-muted-foreground">{['seo-draft-blogs', 'seo-auto-publish', 'seo-validate-articles'].includes(selected.id) ? 'Current status' : 'Blogs published'}</dt><dd className="mt-1 font-medium">{['seo-draft-blogs', 'seo-auto-publish', 'seo-validate-articles'].includes(selected.id) ? record.status : (record.progress ?? `${selected.published} / ${selected.total}`)}</dd></div><div><dt className="text-[9px] font-bold uppercase tracking-[.07em] text-muted-foreground">Workflow</dt><dd className="mt-1 font-medium">{record.workflow ?? selected.name}</dd></div><div><dt className="text-[9px] font-bold uppercase tracking-[.07em] text-muted-foreground">Blog link</dt><dd className="mt-1">{record.url ? <a href={record.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-[#4f83d1] hover:underline">{record.status === 'Published' ? 'Open published blog' : 'Open draft URL'} <ExternalLink className="size-3" /></a> : '—'}</dd></div></dl></details>
            </article>)}</div> : <div className="mt-2 overflow-hidden rounded-xl border bg-white"><div className="grid grid-cols-[1.5fr_.8fr_.7fr_1fr] border-b bg-[#faf9f7] px-3 py-2.5 text-[9px] font-bold uppercase tracking-[.06em] text-muted-foreground"><span>Blog title</span><span>Published</span><span>Progress</span><span>Workflow</span></div><div className="grid min-h-40 place-items-center text-center"><div><div className="mx-auto grid size-10 place-items-center rounded-full bg-muted text-muted-foreground"><BarChart3 className="size-4" /></div><p className="mt-2 text-xs font-bold">No matching records</p><p className="mt-1 text-[10px] text-muted-foreground">Choose All records to see every status, or sync to load the latest data.</p></div></div></div>}
          </div>
        </aside>
      </div>}
    </div>
  );
}
