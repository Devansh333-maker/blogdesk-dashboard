// Read only the publishing results of the explicitly configured Gift Nifty workflow.
const byPost = new Map();
for (const item of $input.all()) {
 const ex = item.json;
 if (String(ex.workflowId || '') !== 'idQAjK21oHKi1uhO') continue;
 const parse = v => { if (typeof v !== 'string') return v || {}; try { return JSON.parse(v); } catch { return {}; } };
 const root = parse(ex.data);
 const runs = (root.resultData ? root : parse(root.data)).resultData?.runData || ex.resultData?.runData || {};
 for (const run of runs['Publish to WordPress'] || []) for (const branch of run.data?.main || []) for (const entry of branch || []) {
  const p = entry.json || {};
  if (!p.postId || !p.status || !p.publishedAt) continue;
  const date = p.debug?.tradingDate || new Date(new Date(p.publishedAt).getTime()+330*60000).toISOString().slice(0,10);
  const key = date + '|' + p.postId;
  const row = {variation_id:'gift-nifty-market-update',event_type:'GIFT_NIFTY_MARKET_UPDATE',trading_date:date,run_id:ex.id,post_id:p.postId,title:p.title || 'Gift Nifty Market Update',status:p.status,published_at:p.publishedAt,post_url:p.link || '',workflow:'Stock Market Today - Pre-Market Trade Guide',current_blog:1,total_blogs:1};
  if (!byPost.has(key) || row.published_at > byPost.get(key).published_at) byPost.set(key,row);
 }
}
return byPost.size ? [...byPost.values()].map(json=>({json})) : [{json:{}}];
