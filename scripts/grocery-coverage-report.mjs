/** Read-only local replay. Never instantiates a store, calls a worker, or accesses the network. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { purchaseScenarioStores } from '../apps/web/src/grocery-purchase-scenarios.ts';
import { validatePlan } from '../apps/worker/src/grocery-planning.ts';

const [directory,today,referenceFile] = process.argv.slice(2);
if (!directory || !/^\d{4}-\d{2}-\d{2}$/.test(today ?? '') || !Number.isFinite(Date.parse(today)) || new Date(today).toISOString().slice(0,10)!==today) {
  throw new Error('Usage: node --import tsx scripts/grocery-coverage-report.mjs <groceries-directory> <YYYY-MM-DD> [reviewed-public-reference-plan.json]');
}
const hashes = {}, read = async name => {
  const raw = await readFile(join(directory,name+'.json'),'utf8');
  hashes[name]=createHash('sha256').update(raw).digest('hex');
  return JSON.parse(raw);
};
const library=await read('purchases'),plan=await read('planning'),resolution=await read('purchase-resolution');
if (referenceFile) {
  const references=validatePlan(JSON.parse(await readFile(referenceFile,'utf8')));
  // A separate reviewed public bundle may be rehearsed in memory; never overwrite saved evidence.
  if (references.prices.some(p=>p.kind!=='public') || references.sourceEstimates?.length || references.purchaseComparisons?.length) throw new Error('Only public product references are allowed in the overlay.');
  for(const key of ['items','retailers','prices']){
    if(references[key].some(r=>plan[key].some(p=>p.id===r.id)))throw new Error('Overlay identifiers must be independent from the saved plan.');
    plan[key].push(...references[key]);
  }
}
const purchases=library.records.filter(r=>r.status==='saved'&&!r.duplicateOf).map((record,index)=>({
  purchase:index+1,lines:record.receipt.items.length,
  stores:purchaseScenarioStores(plan,record,today,resolution,library.records).map(s=>({
    store:s.name,covered:s.covered,estimated:s.estimated,verified:s.verified,complete:s.complete,
    prorata:s.normalized,wholePackages:s.outlay,sourceSubset:s.sourceEstimate,
    missing:s.lines.flatMap((l,line)=>l.normalized===null?[{line:line+1,reasons:l.diagnostic?.reasons??[],explanation:l.reason}]:[])
  }))
}));
// Numbers and line positions suffice for diagnosis; names, receipt IDs and source text stay private.
console.log(JSON.stringify({today,referenceOverlay:!!referenceFile,hashes,purchases},null,2));
