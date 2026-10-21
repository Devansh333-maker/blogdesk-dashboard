import type { CostAnalysis } from './openai-costs';

export const metricKeys = ['num_model_requests','input_tokens','output_tokens','input_cached_tokens','input_cache_write_tokens','input_uncached_tokens','input_text_tokens','output_text_tokens','input_cached_text_tokens','input_audio_tokens','input_cached_audio_tokens','output_audio_tokens','input_image_tokens','input_cached_image_tokens','output_image_tokens','images','characters','seconds','num_requests'];
export const billingModel = (line: string | null) => line?.match(/^((?:gpt-|chatgpt-|text-embedding-|dall-e-|whisper-|tts-|o[134](?:-|$))[^\s,]*)/i)?.[1] || 'Other charges';
export function dateList(from:string,to:string) {
  const result:string[]=[];
  for(let day=from;day<=to&&result.length<180;day=new Date(Date.parse(day+'T00:00:00Z')+86400000).toISOString().slice(0,10)) result.push(day);
  return result;
}
// Rebuild a range from the same daily source rows; never add cached totals twice.
export function combineCostReports(reports:CostAnalysis[],from:string,to:string):CostAnalysis|null {
  if(!reports.length)return null;
  const lines=reports.flatMap(r=>r.actualBilledCosts.dailyLineItems).filter(r=>r.date>=from&&r.date<=to);
  const usage=reports.flatMap(r=>r.dailyUsage).filter(r=>r.date>=from&&r.date<=to);
  const totals=new Map<string,number>();const daily=new Map<string,number>();
  for(const l of lines){totals.set(l.currency,(totals.get(l.currency)||0)+l.amount);const key=JSON.stringify([l.date,l.currency]);daily.set(key,(daily.get(key)||0)+l.amount);}
  return {...reports[0],period:{from,to,startTime:Date.parse(from+'T00:00:00Z')/1000,endTimeExclusive:Date.parse(to+'T00:00:00Z')/1000+86400,timeZone:'UTC'},
    actualBilledCosts:{...reports[0].actualBilledCosts,dailyLineItems:lines,totalsByCurrency:[...totals].map(([currency,amount])=>({currency,amount})),daily:[...daily].map(([k,amount])=>{const [date,currency]=JSON.parse(k);return{date,currency,amount};}),byProject:[],byLineItem:[]},
    dailyUsage:usage,usageByModel:{status:reports.every(r=>r.usageByModel.status==='ready')?'ready':'partial',models:[]},
    generatedAt:reports.map(r=>r.generatedAt).sort()[0],
  };
}

const xml=(v:unknown)=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'');
function sheet(name:string,rows:(string|number|null)[][]){return `<Worksheet ss:Name="${xml(name)}"><Table>${rows.map((r,i)=>`<Row>${r.map(v=>`<Cell${i===0?' ss:StyleID="Header"':''}><Data ss:Type="${typeof v==='number'?'Number':'String'}">${xml(v)}</Data></Cell>`).join('')}</Row>`).join('')}</Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane></WorksheetOptions></Worksheet>`;}
export function costExcel(report:CostAnalysis){
  const currencies=[...new Set(report.actualBilledCosts.dailyLineItems.map(l=>l.currency))].sort();
  const map=new Map<string,{date:string;model:string;metrics:Record<string,number>;costs:Record<string,number>}>();
  const get=(date:string,model:string)=>{const k=JSON.stringify([date,model]);if(!map.has(k))map.set(k,{date,model,metrics:{},costs:{}});return map.get(k)!;};
  for(const u of report.dailyUsage){const row=get(u.date,u.model);for(const k of metricKeys)if(u.metrics[k]!=null)row.metrics[k]=(row.metrics[k]||0)+u.metrics[k]!;}
  for(const l of report.actualBilledCosts.dailyLineItems){const row=get(l.date,billingModel(l.lineItem));row.costs[l.currency]=(row.costs[l.currency]||0)+l.amount;}
  const rows=[...map.values()].sort((a,b)=>a.date.localeCompare(b.date)||a.model.localeCompare(b.model));
  const daily:(string|number|null)[][]=[['Date (UTC)','Model',...metricKeys,'Total tokens',...currencies.map(c=>`Actual cost (${c.toUpperCase()})`) ],...rows.map(r=>[r.date,r.model,...metricKeys.map(k=>r.metrics[k]??null),r.metrics.input_tokens==null&&r.metrics.output_tokens==null?null:(r.metrics.input_tokens||0)+(r.metrics.output_tokens||0),...currencies.map(c=>r.costs[c]??null)])];
  daily.push(['TOTAL','',...metricKeys.map(k=>rows.some(r=>r.metrics[k]!=null)?rows.reduce((s,r)=>s+(r.metrics[k]||0),0):null),rows.reduce((s,r)=>s+(r.metrics.input_tokens||0)+(r.metrics.output_tokens||0),0),...currencies.map(c=>rows.reduce((s,r)=>s+(r.costs[c]||0),0))]);
  return `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="Default"><Font ss:FontName="Aptos" ss:Size="11"/><NumberFormat ss:Format="0.########"/></Style><Style ss:ID="Header"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#214F72" ss:Pattern="Solid"/></Style></Styles>${sheet('Daily models',daily)}${sheet('Usage detail',[['Date (UTC)','Model','Source','Service tier','Batch',...metricKeys],...report.dailyUsage.map(r=>[r.date,r.model,r.source,r.serviceTier,r.batch===null?null:r.batch?'Yes':'No',...metricKeys.map(k=>r.metrics[k]??null)])])}${sheet('Report details',[['Field','Value'],['From',report.period.from],['To',report.period.to],['Scope',report.scope.name],['Time zone','UTC'],['Generated',report.generatedAt],['Cost basis','Actual Costs API charges, not token-price estimates.'],['Attribution','Exact invoice model labels only. Unmatched billing labels remain separate rows; blank costs are not assumed zero.'],['Token definition','Input tokens include cached and cache-write tokens; do not add these breakdown columns again.']])}</Workbook>`;
}
export function downloadCostExcel(report:CostAnalysis){const url=URL.createObjectURL(new Blob(['\uFEFF'+costExcel(report)],{type:'application/vnd.ms-excel;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=`blog-news-automation-${report.period.from}-to-${report.period.to}.xls`;link.click();URL.revokeObjectURL(url);}
