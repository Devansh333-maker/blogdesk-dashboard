export const dynamic = 'force-dynamic';
import {savedBlogSummaries} from '@/lib/blog-summaries';
import {indiaToday} from '@/lib/efficiency-report';
import {mergePublicationHistory, type PublicationSnapshot} from '@/lib/publication-split';
import octoberBackfill from '@/lib/data/october-publication-backfill.json';

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const from = url.searchParams.get('from') || '';
  const to = url.searchParams.get('to') || '';
  if (!validDate(from) || !validDate(to) || from > to || (Date.parse(to) - Date.parse(from)) / 86400000 > 3660) {
    return Response.json({ error: 'Choose a valid date range of up to ten years.' }, { status: 400 });
  }
  const endpoint = process.env.N8N_ANALYTICS_WEBHOOK_URL;
  if (!endpoint) return Response.json({ error: 'Analytics history is not connected yet.' }, { status: 503 });
  try {
    const [response, saved] = await Promise.all([fetch(endpoint, { cache: 'no-store', signal: AbortSignal.timeout(30000) }), savedBlogSummaries(from,to).catch(()=>[])]);
    if (!response.ok) throw new Error('History request failed');
    const data = await response.json() as { snapshots: PublicationSnapshot[]; historyStartsOn?: string | null };
    if (!Array.isArray(data.snapshots)) throw new Error('Invalid history response');
    return Response.json({
      ...data,
      snapshots: mergePublicationHistory(data.snapshots.filter(row=>row.date>=from&&row.date<=to),[...octoberBackfill.snapshots,...saved],indiaToday()).filter(row=>row.date>=from&&row.date<=to),
      publicationBackfill: {from:'2026-10-09',to:'2026-10-15',retrievedAt:octoberBackfill.retrievedAt,unavailableFrom:'2026-10-01',unavailableTo:'2026-10-08'},
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'Saved analytics are temporarily unavailable. Please retry.' }, { status: 502 });
  }
}
