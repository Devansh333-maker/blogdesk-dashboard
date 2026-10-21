// Reporting-only: no article text, URLs, credentials or request bodies leave this extractor.
export function extractCreationTimings(execution, workflow, category) {
  const runs = execution.data?.resultData?.runData || {};
  const nodes = workflow.nodes || [];
  const started = Date.parse(execution.startedAt);
  const canReach = (from, to, seen = new Set()) => {
    if (from === to) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return (workflow.connections?.[from]?.main || []).flat().some(c => c?.node && canReach(c.node, to, seen));
  };
  const creates = nodes.filter(n =>
    (n.type === 'n8n-nodes-base.httpRequest' && n.parameters?.method === 'POST' &&
      /^https:\/\/univest\.in\/blogs-2\/wp-json\/wp\/v2\/posts\/?(?:\?.*)?$/.test(n.parameters?.url || '')) ||
    (n.type === 'n8n-nodes-base.wordpress' && (n.parameters?.resource || 'post') === 'post' && (n.parameters?.operation || 'create') === 'create'));
  const outputs = creates.flatMap(node => (runs[node.name] || []).flatMap(run =>
    (run.data?.main?.[0] || []).filter(item => Number.isInteger(item.json?.id) && item.json.id > 0 && item.json.type === 'post').map(item => ({node, run, postId:item.json.id}))));
  const samples = [], seen = new Set();
  let excluded = 0;
  for (const output of outputs) {
    if (seen.has(output.postId)) continue;
    seen.add(output.postId);
    const loops = nodes.filter(n => n.type === 'n8n-nodes-base.splitInBatches' && canReach(n.name, output.node.name));
    let start = NaN;
    if (loops.length === 1) {
      const previous = (runs[loops[0].name] || []).filter(r => r.startTime <= output.run.startTime &&
        (r.executionIndex ?? -1) < (output.run.executionIndex ?? Infinity) && r.data?.main?.[1]?.length).sort((a,b) => b.startTime-a.startTime)[0];
      // A batch of multiple articles cannot be given one per-article duration.
      if (previous?.data?.main?.[1]?.length === 1) start = previous.startTime;
    } else if (!loops.length && outputs.length === 1) start = started;
    const end = output.run.startTime + output.run.executionTime;
    const waited = nodes.filter(n => n.type === 'n8n-nodes-base.wait').some(n =>
      (runs[n.name] || []).some(r => r.startTime >= start && r.startTime < end));
    const seconds = (end-start)/1000;
    if (waited || !Number.isFinite(seconds) || seconds <= 0 || seconds > 21600) { excluded++; continue; }
    samples.push({postId:output.postId,date:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(end)),seconds,category});
  }
  return {samples,excluded,method:'article input to WordPress creation completed; explicit waits and ambiguous batches excluded'};
}
