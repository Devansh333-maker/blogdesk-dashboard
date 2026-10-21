import {savedCostReport} from '@/lib/cost-snapshots';
import {savedBlogSummaries} from '@/lib/blog-summaries';
import {indiaToday,validRange,makeEfficiencyDays,type BlogSnapshot,type TimeDay,type CostDay,type CreationDay} from '@/lib/efficiency-report';
export const dynamic='force-dynamic';
async function read<T>(endpoint:string|undefined):Promise<T>{
  if(!endpoint)throw Error('Source not connected');
  const response=await fetch(endpoint,{cache:'no-store',signal:AbortSignal.timeout(60000)});
  if(!response.ok)throw Error('Source unavailable');
  return response.json() as Promise<T>;
}
export async function GET(request:Request){
  const url=new URL(request.url),today=indiaToday(),from=url.searchParams.get('from')||'',to=url.searchParams.get('to')||'';
  if(!validRange(from,to,today))return Response.json({error:'Choose a valid date range of up to 180 days, ending no later than today.'},{status:400});
  const [blogResult,timeResult,costResult,summaryResult,creationResult]=await Promise.allSettled([read<{snapshots:BlogSnapshot[]}>(process.env.N8N_ANALYTICS_WEBHOOK_URL),read<{days:TimeDay[]}>(process.env.N8N_TIME_SAVED_WEBHOOK_URL),savedCostReport(from,to),savedBlogSummaries(from,to),read<{days:CreationDay[]}>(process.env.N8N_CREATION_TIMINGS_WEBHOOK_URL)]);
  const warnings:string[]=[],blogs:BlogSnapshot[]=[],times:TimeDay[]=[],costs:CostDay[]=[];
  if(blogResult.status==='fulfilled'&&Array.isArray(blogResult.value.snapshots))blogs.push(...blogResult.value.snapshots);else warnings.push('Blog history is temporarily unavailable.');
  // Reuse today's main-dashboard summary. Closed historical snapshots remain authoritative.
  if(summaryResult.status==='fulfilled')blogs.push(...summaryResult.value.filter(b=>b.date===today));
  if(!blogs.some(b=>b.date===today))warnings.push('Today’s published count has not been synced yet. Use Sync now on the live dashboard; this page does not rescan articles.');
  if(timeResult.status==='fulfilled'&&Array.isArray(timeResult.value.days))times.push(...timeResult.value.days);else warnings.push('Time-saved data is temporarily unavailable.');
  if(costResult.status==='fulfilled'){
    const cached=costResult.value,report=cached.report;
    if(report?.actualBilledCosts.status==='ready')for(const [date,updatedAt] of Object.entries(cached.savedAtByDate)){
      const daily=report.actualBilledCosts.daily.filter(d=>d.date===date);
      costs.push({date,updatedAt,amounts:daily.map(d=>({currency:d.currency,amount:d.amount}))});
    }
  }else warnings.push('Saved cost data is temporarily unavailable.');
  try{
    const creations=creationResult.status==='fulfilled'&&Array.isArray(creationResult.value.days)?creationResult.value.days:[];
    if(creationResult.status!=='fulfilled')warnings.push('Recorded creation timings are temporarily unavailable. Estimated time saved is not used as a substitute.');
    const days=makeEfficiencyDays(from,to,blogs,times,costs,creations);
    return Response.json({from,to,today,days,sources:{blogs:blogResult.status==='fulfilled'||summaryResult.status==='fulfilled',time:timeResult.status==='fulfilled',cost:costResult.status==='fulfilled',creation:creationResult.status==='fulfilled'},generatedAt:new Date().toISOString(),warnings},{headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  }catch{return Response.json({error:'A reporting source returned invalid data. No counts were changed.'},{status:502});}
}
