import { readFile, writeFile, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { prepareFinancesPluginImport, pluginTransactionKey } from '../apps/worker/src/finances-plugin-import.ts';
import { syncContributionEvidence } from '../apps/worker/src/contribution-sync.ts';
import { ContributionReportStore } from '../apps/worker/src/contribution-report-store.ts';
const dataDirectory=resolve(process.argv[2] ?? '');
if(!process.argv[2]) throw new Error('Private data directory required.');
const apply=process.argv.includes('--apply');
const kind=process.argv.includes('--kind=resp')?'resp':'rrsp';
let inputBytes;try{inputBytes=await readFile(join(dataDirectory,'contribution-sync/prepared-'+kind+'-evidence.json'),'utf8')}catch(error){if(kind!=='rrsp'||error.code!=='ENOENT')throw error;inputBytes=await readFile(join(dataDirectory,'contribution-sync/prepared-evidence.json'),'utf8')}
const input=JSON.parse(inputBytes);
const key=(await readFile(join(dataDirectory,'pairing-key.txt'),'utf8')).trim();
async function request(path,body) {
 const response=await fetch('http://127.0.0.1:4713'+path,{method:body?'POST':'GET',headers:{'x-familyhub-key':key,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
 if(!response.ok) throw new Error('Paired finance request rejected: '+response.status);
 return response.json();
}
const transport={read:()=>request('/finances'),preview:bundle=>request('/finances/import',{bundle,apply:false}),apply:(bundle,expectedRevision)=>request('/finances/import',{bundle,apply:true,expectedRevision})};
const before=await transport.read();
if(before.revision!==input.mapping.expectedRevision) throw new Error('Ledger changed since mapping; rebuild private mapping before proceeding.');
const prepared=prepareFinancesPluginImport(input.pages,input.mapping,before);
const preview=await transport.preview(prepared.bundle);
if(preview.possibleDuplicates!==0) throw new Error('Preview found potential duplicates.');
await writeFile(join(dataDirectory,kind==='resp'?'contribution-sync/prepared-resp-bundle.json':'contribution-sync/prepared-bundle.json'),JSON.stringify(prepared.bundle),{mode:0o600});
if(!apply) console.log(JSON.stringify({preview:true,added:preview.added,possibleDuplicates:preview.possibleDuplicates,posted:prepared.postedCount,unassigned:prepared.unassigned.length,ledgerWritten:false}));
else {
 const result=await syncContributionEvidence({...input,reportStore:new ContributionReportStore(join(dataDirectory,'contribution-sync/reports')),transport});
 const after=await transport.read();
 if(JSON.stringify(before.decisions)!==JSON.stringify(after.decisions)||JSON.stringify(before.decisionHistory)!==JSON.stringify(after.decisionHistory)) throw new Error('Concurrent manual decision change detected; inspect preservation.');
 const priorById=new Map(before.data.transactions.map(r=>[r.id,r]));
 for(const [id,old] of priorById){ const current=after.data.transactions.find(r=>r.id===id); if(!current)throw new Error('Historical row missing.'); for(const field of ['accountId','date','description','currency','outflowCents','status','occurrence','fingerprint'])if(JSON.stringify(old[field])!==JSON.stringify(current[field]))throw new Error('Historical financial facts changed.'); }
 const configPath=join(dataDirectory,'contributions/config.json');
 try {
  const config=JSON.parse(await readFile(configPath,'utf8'));const display=config.plans.find(p=>p.id===kind);if(!display)throw new Error('Display plan is not configured.');
  display.verifiedTransferTransactionIds=[...new Set([...(display.verifiedTransferTransactionIds??[]),...input.contributionPlan.verifiedTransferTransactionIds])];
  display.retrievedAt=input.mapping.retrievedAt;
  const rows=input.pages.flatMap(p=>p.result.items),excluded=new Set(input.mapping.excludedTransactionKeys??[]);
  const resolvedId=r=>{const k=pluginTransactionKey(r),v=input.mapping.resolutions[k];return v?.kind==='existing'?v.ledgerId:'finances:'+k};
  const known=new Set(rows.filter(r=>!excluded.has(pluginTransactionKey(r))).map(r=>'finances:'+pluginTransactionKey(r)));
  const unassigned=prepared.unassigned.map(r=>({id:'finances:'+pluginTransactionKey(r),date:r.date,amountCents:Math.round(r.amount*100),currency:r.iso_currency_code}));
  display.unassignedSourceObservations=[...new Map([...(display.unassignedSourceObservations??[]),...unassigned].filter(r=>!known.has(r.id)).map(r=>[r.id,r])).values()];
  if(display.weeklySchedule&&Array.isArray(display.weeklySourceNames)){const weekly=rows.filter(r=>!excluded.has(pluginTransactionKey(r))&&display.weeklySourceNames.includes(r.name)&&Math.round(r.amount*100)===display.weeklySchedule.amountCents).map(resolvedId);display.weeklyTransactionIds=[...new Set([...(display.weeklyTransactionIds??[]),...weekly])];}
  await writeFile(configPath+'.sync.tmp',JSON.stringify(config),{mode:0o600});await rename(configPath+'.sync.tmp',configPath);
 } catch(error){if(error.code!=='ENOENT')throw error;}
 console.log(JSON.stringify({importConfirmed:result.importConfirmed,recoveredUncertainApply:result.recoveredUncertainApply,newRows:after.data.transactions.length-before.data.transactions.length,priorRowsPreserved:priorById.size,manualDecisionsPreserved:true,reportSaved:true}));
}