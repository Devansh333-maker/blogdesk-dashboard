import {publicationSplit, type PublicationFields} from '@/lib/publication-split';
export function PublicationBreakdown({counts,compact=false}:{counts:PublicationFields&{published:number};compact?:boolean}) {
  const split=publicationSplit(counts);
  return <div className={`flex flex-wrap gap-x-3 gap-y-1 ${compact?'text-[10px]':'text-sm'}`} aria-label="Published breakdown">
    <span className="text-[#16806f]"><b>{split.fresh.toLocaleString()}</b> fresh</span>
    <span className="text-[#326aaf]"><b>{split.updated.toLocaleString()}</b> updated</span>
    <span className="text-muted-foreground"><b>{split.unclassified.toLocaleString()}</b> unclassified</span>
  </div>;
}
