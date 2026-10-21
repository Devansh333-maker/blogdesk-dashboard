import {publicationSplit, emptyPublicationSplit, type PublicationFields} from './publication-split';
import {blogCategory} from './blog-catalog';
export type BlogCounts = PublicationFields & { published: number; drafts: number; processing: number; failed: number; total: number };
export type BlogSnapshot = { date: string; capturedAt: string; kind: string; variations: (BlogCounts & { id: string; name: string; group: string })[] };
export type TimeCategory = { category: string; minutesSaved: number; successfulRuns: number; estimatedArticles: number };
export type TimeDay = { date: string; minutesSaved: number; successfulRuns: number; estimatedArticles: number; updatedAt: string; kind: string; breakdown: TimeCategory[] };
export type CostDay = { date: string; amounts: { currency: string; amount: number }[]; updatedAt: string };
export type CreationDay = {date:string;totalMinutes:number;timedArticles:number;excludedArticles:number;updatedAt:string;breakdown:{category:string;totalMinutes:number;timedArticles:number}[]};
export type EfficiencyDay = { date: string; blogs: BlogCounts | null; blogCapturedAt: string | null; blogKind: string | null; time: TimeDay | null; cost: CostDay | null; creation:CreationDay|null;creationMinutesPerArticle:number|null;minutesPerPublished: number | null; costPerPublished: { currency: string; amount: number }[] | null };
export type EfficiencyReport = { from: string; to: string; today: string; days: EfficiencyDay[]; sources: { blogs: boolean; time: boolean; cost: boolean;creation?:boolean }; generatedAt: string; warnings: string[] };

export const indiaToday = () => new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export const shiftDate = (date:string,days:number) => new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
export function validRange(from:string,to:string,today=indiaToday()) {
  const valid=(d:string)=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
  return valid(from)&&valid(to)&&from<=to&&to<=today&&(Date.parse(to)-Date.parse(from))/86400000<180;
}
export function sumBlogs(snapshot:BlogSnapshot):BlogCounts {
  return snapshot.variations.reduce((s,v)=>{for(const k of ['published','drafts','processing','failed','total'] as const){if(!Number.isInteger(v[k])||v[k]<0)throw Error('Invalid blog count');s[k]+=v[k];}return s;},{published:0,drafts:0,processing:0,failed:0,total:0});
}
export function makeEfficiencyDays(from:string,to:string,blogs:BlogSnapshot[],times:TimeDay[],costs:CostDay[],creations:CreationDay[]=[]):EfficiencyDay[] {
  const latest=new Map<string,BlogSnapshot>();
  for(const b of blogs){const old=latest.get(b.date);if(!old||b.capturedAt>old.capturedAt)latest.set(b.date,b);}
  const tm=new Map(times.map(t=>[t.date,t])),cm=new Map(costs.map(c=>[c.date,c])),creationMap=new Map(creations.map(c=>[c.date,c]));
  const result:EfficiencyDay[]=[];
  for(let date=from;date<=to&&result.length<180;date=shiftDate(date,1)){
    const snapshot=latest.get(date), b=snapshot?sumBlogs(snapshot):null,t=tm.get(date)||null,c=cm.get(date)||null;
    const creation=creationMap.get(date)||null;
    if(creation&&(!Number.isInteger(creation.timedArticles)||creation.timedArticles<0||!Number.isFinite(creation.totalMinutes)||creation.totalMinutes<0))throw Error('Invalid creation timing');
    result.push({date,blogs:b,blogCapturedAt:snapshot?.capturedAt||null,blogKind:snapshot?.kind||null,time:t,cost:c,creation,creationMinutesPerArticle:creation&&creation.timedArticles>0?creation.totalMinutes/creation.timedArticles:null,minutesPerPublished:b&&b.published>0&&t?t.minutesSaved/b.published:null,costPerPublished:b&&b.published>0&&c?c.amounts.map(a=>({...a,amount:a.amount/b.published})):null});
  }
  return result;
}
export function summarizeEfficiency(days:EfficiencyDay[]) {
  const blogDays=days.filter(d=>d.blogs),timeDays=days.filter(d=>d.time),costDays=days.filter(d=>d.cost);
  const matched=days.filter(d=>d.blogs&&d.time&&d.cost);
  const costs:Record<string,number>={},matchedCosts:Record<string,number>={};
  for(const d of costDays)for(const c of d.cost!.amounts)costs[c.currency]=(costs[c.currency]||0)+c.amount;
  for(const d of matched)for(const c of d.cost!.amounts)matchedCosts[c.currency]=(matchedCosts[c.currency]||0)+c.amount;
  const published=blogDays.reduce((s,d)=>s+d.blogs!.published,0),minutes=timeDays.reduce((s,d)=>s+d.time!.minutesSaved,0);
  const matchedPublished=matched.reduce((s,d)=>s+d.blogs!.published,0),matchedMinutes=matched.reduce((s,d)=>s+d.time!.minutesSaved,0);
  const timedArticles=days.reduce((s,d)=>s+(d.creation?.timedArticles||0),0),creationMinutes=days.reduce((s,d)=>s+(d.creation?.totalMinutes||0),0);
  return {published,minutes,costs,timedArticles,creationMinutes,creationMinutesPerArticle:timedArticles>0?creationMinutes/timedArticles:null,blogDays:blogDays.length,timeDays:timeDays.length,costDays:costDays.length,totalDays:days.length,matchedDays:matched.length,dailyPublished:blogDays.length?published/blogDays.length:null,dailyMinutes:timeDays.length?minutes/timeDays.length:null,minutesPerPublished:matchedPublished>0?matchedMinutes/matchedPublished:null,costPerPublished:matchedPublished>0?Object.fromEntries(Object.entries(matchedCosts).map(([c,n])=>[c,n/matchedPublished])):null};
}
export function currentBlogSnapshot(payload:{tradingDate?:string;syncedAt?:string;warning?:string;rowsByVariation?:Record<string,Record<string,unknown>[]>;sourceDates?:Record<string,string|null>},date:string):BlogSnapshot {
  if(payload.warning||payload.tradingDate!==date||!payload.rowsByVariation||!payload.syncedAt)throw Error('Today’s blog source is unavailable.');
  const statusGroups:Record<string,'published'|'drafts'|'processing'|'failed'>={publish:'published',published:'published',updated:'published',published_verified:'published',draft:'drafts',pending:'drafts',future:'drafts',private:'drafts',processing:'processing',running:'processing',locked:'processing',queued:'processing',new:'processing',waiting:'processing',publisher_started:'processing',failed:'failed',error:'failed',failure:'failed',failed_retryable:'failed',failed_terminal:'failed',crashed:'failed',canceled:'failed',cancelled:'failed'};
  const variations=Object.entries(payload.rowsByVariation).map(([id,rows])=>{
    if(!Array.isArray(rows))throw Error('Invalid current blog data');
    const counts:BlogCounts={published:0,drafts:0,processing:0,failed:0,total:0};
    const split=emptyPublicationSplit();
    for(const row of rows){if(String(row.trading_date||payload.sourceDates?.[id]||date).slice(0,10)!==date)continue;const status=statusGroups[String(row.status||'').toLowerCase().trim()];if(!status)throw Error('Unrecognized current blog status');counts[status]++;counts.total++;if(status==='published')split[row.publication_kind==='fresh'?'fresh':row.publication_kind==='updated'?'updated':'unclassified']++;}
    return {id,...blogCategory(id),...counts,...publicationSplit({...counts,...split})};
  });
  return {date,capturedAt:payload.syncedAt,kind:'live',variations};
}
const xmlEscape=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
export function efficiencyExcel(days:EfficiencyDay[],from:string,to:string) {
  const cell=(n:string|number|null)=>`<Cell><Data ss:Type="${typeof n==='number'?'Number':'String'}">${n===null?'Unavailable':typeof n==='string'?xmlEscape(n):n}</Data></Cell>`;
  const currencies=[...new Set(days.flatMap(d=>d.cost?.amounts.map(c=>c.currency)||[]))].sort();
  const headers=['Date (blogs/time IST; cost UTC)','Published','Drafts','Processing','Failed','Total blogs','Estimated time saved (minutes)','Estimated time saved (hours)','Avg time saved / published article (estimated minutes)','Recorded creation time (minutes)','Timed articles (partial coverage)','Avg article creation time (minutes)',...currencies.flatMap(c=>[`Actual cost (${c.toUpperCase()})`,`Avg cost / published article (${c.toUpperCase()})`]),'Blog snapshot','Time source updated','Cost updated'];
  const rows=days.map(d=>[d.date,d.blogs?.published??null,d.blogs?.drafts??null,d.blogs?.processing??null,d.blogs?.failed??null,d.blogs?.total??null,d.time?.minutesSaved??null,d.time?d.time.minutesSaved/60:null,d.minutesPerPublished,d.creation?.totalMinutes??null,d.creation?.timedArticles??null,d.creationMinutesPerArticle,...currencies.flatMap(c=>[d.cost?d.cost.amounts.find(a=>a.currency===c)?.amount??0:null,d.costPerPublished?.find(a=>a.currency===c)?.amount??null]),d.blogKind||'Unavailable',d.time?.updatedAt||'Unavailable',d.cost?.updatedAt||'Unavailable']);
  const summary=summarizeEfficiency(days);
  const totals=['TOTAL (available days)',summary.blogDays?summary.published:null,...(['drafts','processing','failed','total'] as const).map(k=>summary.blogDays?days.reduce((s,d)=>s+(d.blogs?.[k]||0),0):null),summary.timeDays?summary.minutes:null,summary.timeDays?summary.minutes/60:null,summary.minutesPerPublished,summary.timedArticles?summary.creationMinutes:null,summary.timedArticles||null,summary.creationMinutesPerArticle,...currencies.flatMap(c=>[summary.costs[c]??null,summary.costPerPublished?.[c]??null]),`${summary.blogDays}/${days.length} blog days`,`${summary.timeDays}/${days.length} time days`,`${summary.costDays}/${days.length} cost days`];
  const details=days.flatMap(d=>d.time?.breakdown.map(c=>[d.date,c.category,c.minutesSaved,c.successfulRuns,c.estimatedArticles,d.time!.updatedAt])||[]);
  const creationDetails=days.flatMap(d=>d.creation?.breakdown.map(c=>[d.date,c.category,c.totalMinutes,c.timedArticles,c.timedArticles>0?c.totalMinutes/c.timedArticles:null,d.creation!.updatedAt])||[]);
  const table=(name:string,columns:string[],data:(string|number|null)[][])=>`<Worksheet ss:Name="${name}"><Table><Row>${columns.map(cell).join('')}</Row>${data.map(r=>`<Row>${r.map(cell).join('')}</Row>`).join('')}</Table></Worksheet>`;
  return `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">${table('Daily Efficiency',headers,rows.concat([totals]))}${table('Time by category',['Date (IST)','Category','Estimated minutes saved','Successful runs','Tracker article estimate (not published count)','Updated'],details)}${table('Measured creation',['Date (IST)','Category','Recorded creation time (minutes)','Timed articles','Avg article creation time (minutes)','Updated'],creationDetails)}${table('Report context',['Period','Metric definition'],[[`${from} to ${to}`,'Time saved is a workflow estimate, not measured duration. SEO bulk runs count a minimum of one article per successful run.'],['Creation time','Recorded elapsed automated processing from article input (or single-article workflow start) to WordPress creation completed. Network/service time included; explicit waits, ambiguous batches and update-only URLs excluded. Partial coverage.'],['Per-article averages','Creation average = recorded creation minutes / timed articles. Saved-time and cost averages divide daily totals by published count; no article-level cost allocation. Period saved-time/cost averages use only matched-source days.'],['Published count','Today reuses the main dashboard server-synced summary and timestamp. This page does not rescan articles; use the live dashboard Sync now to update published counts.'],['Time zones','Blogs and time use IST. Actual Costs API amounts use UTC billing dates; comparisons are indicative, not exact same-window costs.'],['Missing dates','Unavailable is not zero. Actual cost is blog-news-automation scope, not the whole organization.']])}</Workbook>`;
}
