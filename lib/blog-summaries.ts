import {env} from 'cloudflare:workers';
import {currentBlogSnapshot,indiaToday,type BlogSnapshot} from './efficiency-report';
const db=()=>{const binding=(env as unknown as {DB?:D1Database}).DB;if(!binding)throw Error('Summary storage unavailable');return binding;};
// Only the server's successful read of the configured source can supply counts.
// There is deliberately no endpoint accepting visitor-supplied blog totals.
export async function saveBlogSummary(payload:Parameters<typeof currentBlogSnapshot>[0]) {
  const snapshot=currentBlogSnapshot(payload,indiaToday());
  await db().prepare('INSERT INTO blog_daily_summaries (date,payload,updated_at) VALUES (?,?,?) ON CONFLICT(date) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at WHERE excluded.updated_at >= blog_daily_summaries.updated_at')
    .bind(snapshot.date,JSON.stringify(snapshot),snapshot.capturedAt).run();
}
export async function savedBlogSummaries(from:string,to:string):Promise<BlogSnapshot[]> {
  const {results}=await db().prepare('SELECT payload FROM blog_daily_summaries WHERE date >= ? AND date <= ? ORDER BY date').bind(from,to).all<{payload:string}>();
  return results.map(r=>JSON.parse(r.payload) as BlogSnapshot);
}
