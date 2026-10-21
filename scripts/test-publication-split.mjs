import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
const cache=new Map();
function load(name){
  const file=path.resolve('lib',name+'.ts');if(cache.has(file))return cache.get(file);
  const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};new Function('require','exports','module',code)(p=>load(p.replace('./','')),module.exports,module);cache.set(file,module.exports);return module.exports;
}
const {classifyPublication,publicationDay,publicationSplit,mergePublicationHistory}=load('publication-split');
const {enrichPublicationRows,publicBlogUrl}=load('publication-metadata');
const {currentBlogSnapshot}=load('efficiency-report');
const day='2026-10-16';
assert.equal(publicationDay('2026-10-15T18:30:00'),day);
assert.equal(publicationDay('2026-10-15T18:29:59'),'2026-10-15');
assert.equal(publicationDay('invalid'),null);
const post=(date,modified=day+'T07:00:00',status='publish')=>({date_gmt:date,modified_gmt:modified,status});
assert.equal(classifyPublication(post(day+'T01:00:00'),day),'fresh');
assert.equal(classifyPublication(post('2026-09-01T01:00:00'),day),'updated');
assert.equal(classifyPublication(post('2026-09-01T01:00:00','2026-10-15T01:00:00'),day),'unclassified');
assert.equal(classifyPublication(post(day+'T01:00:00',undefined,'draft'),day),'unclassified');
assert.equal(classifyPublication(undefined,day),'unclassified');
assert.deepEqual(publicationSplit({published:9,fresh:3,updated:4}),{fresh:3,updated:4,unclassified:2});
assert.deepEqual(publicationSplit({published:9,fresh:12}),{fresh:0,updated:0,unclassified:9});
for(const url of ['http://univest.in/blogs-2/a','https://evil.test/blogs-2/a','https://univest.in@evil.test/blogs-2/a','https://univest.in:8080/blogs-2/a','https://univest.in/blogs-2/wp-json/wp/v2/users','file:///etc/passwd'])assert.equal(publicBlogUrl(url),null);
const originalFetch=globalThis.fetch;
let calls=0;
globalThis.fetch=async(url,options)=>{calls++;assert.equal(options.redirect,'manual');assert.equal(options.method,undefined);assert(String(url).startsWith('https://univest.in/blogs-2/wp-json/wp/v2/posts?'));return {ok:true,json:async()=>[{id:1,link:'https://univest.in/blogs-2/new/',...post(day+'T01:00:00')},{id:2,link:'https://univest.in/blogs-2/old/',...post('2026-09-01T01:00:00')}]};};
const input={test:[{status:'Published',post_id:1,post_url:'https://univest.in/blogs-2/new/',publication_mode:'UPDATE_ORIGINAL'},{status:'Published',post_id:2,post_url:'https://univest.in/blogs-2/old/',publication_mode:'CREATE_CONSECUTIVE'},{status:'Draft',post_id:3},{status:'Failed'},{status:'Published',post_id:1,post_url:'https://univest.in/blogs-2/mismatch/'}]};
const enriched=await enrichPublicationRows(input,day);
assert.equal(calls,1);assert.equal(input.test[0].publication_kind,undefined);
assert.equal(enriched.test[0].publication_kind,'fresh');assert.equal(enriched.test[1].publication_kind,'updated');assert.equal(enriched.test[2].publication_kind,undefined);assert.equal(enriched.test[4].publication_kind,'unclassified');
globalThis.fetch=async()=>{throw Error('Unavailable');};
assert.equal((await enrichPublicationRows(input,day)).test[0].publication_kind,'unclassified');
globalThis.fetch=originalFetch;
const snapshot=currentBlogSnapshot({tradingDate:day,syncedAt:day+'T07:00:00Z',rowsByVariation:enriched},day);
assert.deepEqual(publicationSplit(snapshot.variations[0]),{fresh:1,updated:1,unclassified:1});
const legacy={date:'2026-10-15',capturedAt:'2026-10-15T18:25:00Z',kind:'end-of-day',variations:[{id:'test',name:'Test',group:'Test',published:3,drafts:1,processing:0,failed:1,total:5}]};
const merged=mergePublicationHistory([legacy],[snapshot],day);
assert.equal(merged.length,2);assert.equal(merged[0].variations[0].unclassified,3);assert.equal(legacy.variations[0].unclassified,undefined);
const matching=mergePublicationHistory([{...snapshot,kind:'end-of-day'}],[snapshot],day);
assert.equal(matching[0].kind,'end-of-day');assert.equal(matching[0].variations[0].fresh,1);
const mismatch=mergePublicationHistory([{...snapshot,variations:[{...snapshot.variations[0],published:4,total:6}]}],[snapshot],day);
assert.equal(mismatch[0].variations[0].unclassified,4);assert.equal(mismatch[0].variations[0].fresh,0);
const legacyCache={...snapshot,variations:snapshot.variations.map(({fresh,updated,unclassified,...v})=>v)};
const backfillWithLegacy=mergePublicationHistory([{...snapshot,kind:'end-of-day'}],[snapshot,legacyCache],day);
assert.equal(backfillWithLegacy[0].variations[0].fresh,1);
assert.equal(backfillWithLegacy[0].variations[0].updated,1);
const reconstructed=JSON.parse(fs.readFileSync('lib/data/october-publication-backfill.json','utf8'));
for(const saved of reconstructed.snapshots)for(const row of saved.variations){const split=publicationSplit(row);assert.equal(split.fresh+split.updated+split.unclassified,row.published);assert.equal(row.published+row.drafts+row.processing+row.failed,row.total);}
const originalHistory='../work/october-publication-original-history.json';
if(fs.existsSync(originalHistory)){
 const original=JSON.parse(fs.readFileSync(originalHistory,'utf8')).snapshots;
 const applied=mergePublicationHistory(original,reconstructed.snapshots,day);
 for(const old of original){const result=applied.find(s=>s.date===old.date);assert.equal(result.kind,old.kind);assert.equal(result.capturedAt,old.capturedAt);for(const row of old.variations){const updated=result.variations.find(v=>v.id===row.id);for(const k of ['published','drafts','processing','failed','total'])assert.equal(updated[k],row[k]);}}
 assert.equal(applied.find(s=>s.date==='2026-10-09').variations.reduce((n,v)=>n+v.fresh,0),991);
 assert.equal(applied.find(s=>s.date==='2026-10-09').variations.reduce((n,v)=>n+v.updated,0),581);
}
// Re-run the verified 16 Oct dataset without network calls.
const recordsPath='../work/fresh-updated-oct16-records.json',metadataPath='../work/fresh-updated-oct16-wordpress.json';
if(fs.existsSync(recordsPath)&&fs.existsSync(metadataPath)){
  const source=JSON.parse(fs.readFileSync(recordsPath)),metadata=JSON.parse(fs.readFileSync(metadataPath));
  const byId=new Map(metadata.posts.map(p=>[String(p.id),p])),byLink=new Map(metadata.posts.map(p=>[p.link.replace(/\/$/,''),p]));
  const totals={fresh:0,updated:0,unclassified:0};for(const row of source.records)totals[classifyPublication(byId.get(String(row.id))||byLink.get(row.url.replace(/\/$/,'')),source.date)]++;
  assert.deepEqual(totals,{fresh:313,updated:346,unclassified:0});
}
console.log('Passed: IST midnight, first publication, old URL updates despite CREATE labels, missing metadata, URL safety, draft separation, snapshot persistence and historical reconciliation.');
