export type PublicationKind = 'fresh' | 'updated' | 'unclassified';
export type PublicationSplit = { fresh: number; updated: number; unclassified: number };
export type PublicationFields = Partial<PublicationSplit>;
export const publicationLabel = (kind?: string) => kind === 'fresh' ? 'Freshly published' : kind === 'updated' ? 'Updated on same URL' : 'Unclassified';
export const emptyPublicationSplit = (): PublicationSplit => ({fresh: 0, updated: 0, unclassified: 0});
export function publicationSplit(value: PublicationFields & {published: number}): PublicationSplit {
  const fresh = value.fresh ?? 0, updated = value.updated ?? 0;
  if (![fresh, updated].every(n => Number.isInteger(n) && n >= 0) || fresh + updated > value.published) return {fresh:0, updated:0, unclassified:value.published};
  return {fresh, updated, unclassified:value.published - fresh - updated};
}
export function publicationDay(gmt: unknown): string | null {
  if (typeof gmt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z)?$/.test(gmt)) return null;
  const timestamp = Date.parse(gmt.endsWith('Z') ? gmt : gmt + 'Z');
  return Number.isFinite(timestamp) ? new Date(timestamp + 19_800_000).toISOString().slice(0,10) : null;
}
export type PublicPost = {id?:number;link?:string;status?:string;date_gmt?:string;modified_gmt?:string};
export function classifyPublication(post: PublicPost | undefined, date: string): PublicationKind {
  if (!post || post.status !== 'publish') return 'unclassified';
  const published = publicationDay(post.date_gmt), modified = publicationDay(post.modified_gmt);
  if (!published || !modified || published > date || modified < date) return 'unclassified';
  // A later edit must not turn an article first published on this day into an update.
  return published === date ? 'fresh' : 'updated';
}

export type SnapshotVariation = PublicationFields & {id:string;name:string;group:string;published:number;drafts:number;processing:number;failed:number;total:number};
export type PublicationSnapshot = {date:string;capturedAt:string;kind:string;variations:SnapshotVariation[]};
export function mergePublicationHistory(history: PublicationSnapshot[], classified: PublicationSnapshot[], today: string): PublicationSnapshot[] {
  const byDate = new Map<string,PublicationSnapshot[]>();
  for(const snapshot of classified)byDate.set(snapshot.date,[...(byDate.get(snapshot.date)||[]),snapshot]);
  const result = history.map(snapshot => {
    const saved = byDate.get(snapshot.date) || [];
    return {...snapshot, variations:snapshot.variations.map(row => {
      // A legacy cache must not hide a verified backfill. Compare candidates only
      // within identical captured status totals; never rewrite the original counts.
      const candidate = saved.flatMap(s=>s.variations).filter(v=>v.id===row.id && (['published','drafts','processing','failed','total'] as const).every(k=>v[k]===row[k]))
        .sort((a,b)=>publicationSplit(a).unclassified-publicationSplit(b).unclassified)[0];
      return {...row, ...publicationSplit(candidate || {published:row.published})};
    })};
  });
  const live = byDate.get(today)?.toSorted((a,b)=>b.capturedAt.localeCompare(a.capturedAt))[0];
  if (live && !result.some(s=>s.date===today)) result.push({...live,kind:'partial-day',variations:live.variations.map(v=>({...v,...publicationSplit(v)}))});
  return result.sort((a,b)=>a.date.localeCompare(b.date));
}
