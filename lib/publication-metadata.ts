import {classifyPublication, publicationDay, type PublicPost} from './publication-split';

type Row = Record<string, unknown>;
const endpoint = 'https://univest.in/blogs-2/wp-json/wp/v2/posts';
const fields = 'id,link,status,date_gmt,modified_gmt';
export function publicBlogUrl(value: unknown): URL | null {
  try {
    const url=new URL(String(value));
    if(url.protocol!=='https:' || url.hostname!=='univest.in' || url.port || url.username || url.password || !/^\/blogs-2\/[a-zA-Z0-9%_-]+\/?$/.test(url.pathname))return null;
    return url;
  } catch {return null;}
}
const linkKey = (link:string) => link.replace(/\/$/,'');
const isPublished = (row:Row) => ['published','publish','published_verified','updated'].includes(String(row.status||'').toLowerCase());
async function readMetadata(query: URLSearchParams, overallSignal:AbortSignal): Promise<PublicPost[]> {
  try {
    const response=await fetch(`${endpoint}?${query}`,{cache:'no-store',redirect:'manual',signal:overallSignal});
    if(!response.ok){console.warn('Publication metadata unavailable',{status:response.status});return [];}
    const data=await response.json();
    return Array.isArray(data)?data.filter(p=>p&&Number.isSafeInteger(p.id)&&publicBlogUrl(p.link)):[];
  } catch(error) {console.warn('Publication metadata unavailable',{errorType:error instanceof Error?error.name:'unknown'});return [];}
}
export async function enrichPublicationRows(rowsByVariation:Record<string,Row[]>,date:string) {
  const rows=Object.values(rowsByVariation).flat().filter(r=>isPublished(r)&&String(r.trading_date||date).slice(0,10)===date);
  const ids=[...new Set(rows.filter(r=>publicBlogUrl(r.post_url||r.url)).map(r=>Number(r.post_id)).filter(n=>Number.isSafeInteger(n)&&n>0))];
  const slugs=[...new Set(rows.filter(r=>!Number(r.post_id)).map(r=>publicBlogUrl(r.post_url||r.url)?.pathname.split('/').filter(Boolean).at(-1)).filter((s):s is string=>Boolean(s)))];
  const queries:URLSearchParams[]=[];
  for(let i=0;i<ids.length;i+=100)queries.push(new URLSearchParams({per_page:'100',include:ids.slice(i,i+100).join(','),_fields:fields}));
  for(let i=0;i<slugs.length;i+=40)queries.push(new URLSearchParams({per_page:'100',slug:slugs.slice(i,i+40).join(','),_fields:fields}));
  // Bounded parallel GETs; never fetch article bodies or accept a visitor-supplied endpoint.
  const posts:PublicPost[]=[];
  const overallSignal=AbortSignal.timeout(25_000);
  for(let i=0;i<queries.length&&!overallSignal.aborted;i+=4)posts.push(...(await Promise.all(queries.slice(i,i+4).map(q=>readMetadata(q,overallSignal)))).flat());
  const byId=new Map(posts.map(p=>[Number(p.id),p]));
  const byLink=new Map(posts.map(p=>[linkKey(p.link!),p]));
  return Object.fromEntries(Object.entries(rowsByVariation).map(([id,items])=>[id,items.map(row=>{
    if(!isPublished(row))return row;
    const url=publicBlogUrl(row.post_url||row.url);
    const post=url?(byId.get(Number(row.post_id))||byLink.get(linkKey(url.href))):undefined;
    // A conflicting ID/link pair is not sufficient evidence.
    const verified=post&&url&&linkKey(post.link!)===linkKey(url.href)?post:undefined;
    return {...row,publication_kind:classifyPublication(verified,date),publication_evidence:verified?'wordpress-publication-timestamps':'unavailable',first_published_at:publicationDay(verified?.date_gmt)?`${verified!.date_gmt!.replace(/Z$/,'')}Z`:null,last_modified_at:publicationDay(verified?.modified_gmt)?`${verified!.modified_gmt!.replace(/Z$/,'')}Z`:null};
  })]));
}
