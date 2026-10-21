import {
  allowPublicReportAttempt,
  jsonPrivate,
  acceptsSameOriginJson,
} from '@/lib/cost-security';
import { getOpenAICostAnalysis, OpenAIAdminError, parseCostDateRange } from '@/lib/openai-costs';
import { savedCostReport, saveCostReport } from '@/lib/cost-snapshots';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return handle(request, false);
}
export async function POST(request: Request) {
  if (!acceptsSameOriginJson(request)) return jsonPrivate({error:'Invalid request origin.'},{status:403});
  return handle(request, true);
}
async function handle(request:Request, refresh:boolean) {
  try {
    if (!await allowPublicReportAttempt(request)) {
      return jsonPrivate({ error: 'Too many refreshes. Try again in a minute.' }, { status: 429 });
    }
    const url = new URL(request.url);
    const range = parseCostDateRange(url.searchParams.get('from') ?? '', url.searchParams.get('to') ?? '');
    if (!range) {
      return jsonPrivate({ error: 'Choose a valid daily range of up to 180 days that does not extend into the future.' }, { status: 400 });
    }
    if (!refresh) return jsonPrivate(await savedCostReport(range.from,range.to));
    // Explicit Sync updates today; backfill only missing older days on the first sync.
    const cached=await savedCostReport(range.from,range.to);
    const today=new Date().toISOString().slice(0,10);
    const syncOnly=url.searchParams.get('mode')==='sync';
    const start=syncOnly ? [...cached.missingDates,today].filter(d=>d>=range.from&&d<=range.to).sort()[0] : range.from;
    if(start){
      const fresh=await getOpenAICostAnalysis(parseCostDateRange(start,range.to)!);
      if(fresh.actualBilledCosts.status!=='ready'||fresh.usageByModel.status!=='ready')return jsonPrivate({error:'Some cost or usage data is unavailable. Your last saved report has been kept.'},{status:502});
      await saveCostReport(fresh);
    }
    return jsonPrivate(await savedCostReport(range.from,range.to));
  } catch (error) {
    if (error instanceof OpenAIAdminError) {
      if (error.code === 'auth') {
        return jsonPrivate({ error: 'The OpenAI credential in n8n could not access Costs and Usage. Check its Authorization header and organization permissions.' }, { status: 503 });
      }
      if (error.code === 'rate_limit') {
        return jsonPrivate({ error: 'OpenAI temporarily rate-limited this report. Try again shortly.' }, { status: 429 });
      }
      return jsonPrivate({ error: 'OpenAI cost data is temporarily unavailable.' }, { status: 502 });
    }
    return jsonPrivate({ error: 'Cost Analysis is temporarily unavailable.' }, { status: 503 });
  }
}
