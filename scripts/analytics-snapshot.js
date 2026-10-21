const catalog = [{"id":"gift-nifty-market-update","name":"Gift Nifty Market Update","group":"Gift Nifty Market Update"},{"id":"old-url-52wh","name":"52-Week High","group":"Old URL System"},{"id":"old-url-52wl","name":"52-Week Low","group":"Old URL System"},{"id":"old-url-price-rise","name":"Price Rise","group":"Old URL System"},{"id":"old-url-price-fall","name":"Price Fall","group":"Old URL System"},{"id":"52wh","name":"52-Week High","group":"System 1"},{"id":"52wl","name":"52-Week Low","group":"System 1"},{"id":"price-rise","name":"Price Rise","group":"System 1"},{"id":"price-fall","name":"Price Fall","group":"System 1"},{"id":"near-52wh","name":"Near 52-Week High","group":"System 2"},{"id":"near-52wl","name":"Near 52-Week Low","group":"System 2"},{"id":"near-ath","name":"Near All-Time High","group":"System 2"},{"id":"near-atl","name":"Near All-Time Low","group":"System 2"},{"id":"mutual-funds","name":"Mutual Funds","group":"Funds & Circuits"},{"id":"upper-circuit","name":"Upper Circuit","group":"Funds & Circuits"},{"id":"lower-circuit","name":"Lower Circuit","group":"Funds & Circuits"},{"id":"quarterly-results","name":"Quarterly Results","group":"Quarterly Results"},{"id":"opening-bell","name":"Opening Bell","group":"Nifty 50 Market Update"},{"id":"midday","name":"Midday Update","group":"Nifty 50 Market Update"},{"id":"closing-bell","name":"Closing Bell","group":"Nifty 50 Market Update"},{"id":"top-gainers","name":"Top 2 Gainers","group":"Nifty Index Updates"},{"id":"top-losers","name":"Top 2 Losers","group":"Nifty Index Updates"},{"id":"sector-updates","name":"Sector Updates","group":"Nifty Index Updates"},{"id":"seo-draft-blogs","name":"Draft Blogs","group":"SEO Team Blogs"},{"id":"seo-auto-publish","name":"Auto Publish Blogs","group":"SEO Team Blogs"}];
const payload = $input.first().json;
const now = new Date();
const india = new Date(now.getTime() + 330 * 60000);
const date = india.toISOString().slice(0,10);
if (!payload.rowsByVariation || payload.warning || !payload.syncedAt || now.getTime()-new Date(payload.syncedAt).getTime()>15*60000) throw new Error('No fresh successful feed; analytics snapshot was not written.');
const sourceDates = payload.sourceDates || {};
const rows = catalog.map(category => {
  const sourceDate = sourceDates[category.id] || payload.tradingDate || null;
  const all = payload.rowsByVariation[category.id] || [];
  if (!Array.isArray(all)) throw new Error('Invalid category data: '+category.id);
  const eligible = all.filter(row => String(row.trading_date || sourceDate || '').slice(0,10) === date);
  const counts = {published:0,drafts:0,processing:0,failed:0,total:eligible.length};
  for (const row of eligible) {
    const status=String(row.status || '').trim().toLowerCase();
    if (['publish','published','published_verified','updated'].includes(status)) counts.published++;
    else if (['draft','pending','future','private'].includes(status)) counts.drafts++;
    else if (['failed','error','failure','failed_retryable','failed_terminal','crashed','canceled','cancelled'].includes(status)) counts.failed++;
    else if (['processing','running','locked','queued','publisher_started','new','waiting'].includes(status)) counts.processing++;
    else throw new Error('Unrecognized status for '+category.id+': '+status);
  }
  return {...category,...counts,sourceDate};
});
const kind = india.getUTCHours()===23 && india.getUTCMinutes()>=55 ? 'end-of-day' : 'partial';
return [{json:{report_date:date,captured_at:now.toISOString(),snapshot_kind:kind,payload:JSON.stringify(rows)}}];
