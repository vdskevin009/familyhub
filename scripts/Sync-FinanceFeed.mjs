/** Owner-authorized private preparation only; preview is default. No collection or scheduling. */
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { prepareFinanceFeed, syncFinanceFeed } from '../apps/worker/src/finances-full-feed.ts';
if(!process.argv[2]) throw new Error('Explicit private data directory required.');
const directory=resolve(process.argv[2]), apply=process.argv.includes('--apply');
const input=JSON.parse(await readFile(join(directory,'finance-feed/prepared-evidence.json'),'utf8'));
const key=(await readFile(join(directory,'pairing-key.txt'),'utf8')).trim();
async function request(path,body){
 const response=await fetch('http://127.0.0.1:4713'+path,{method:body?'POST':'GET',headers:{'x-familyhub-key':key,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
 if(!response.ok) throw new Error('Paired finance request rejected: '+response.status);
 return response.json();
}
const transport={read:()=>request('/finances'),preview:bundle=>request('/finances/import',{bundle,apply:false}),apply:(bundle,expectedRevision)=>request('/finances/import',{bundle,apply:true,expectedRevision})};
if(apply){const result=await syncFinanceFeed({...input,transport});console.log(JSON.stringify({importConfirmed:result.importConfirmed,recoveredUncertainApply:result.recoveredUncertainApply,withheldCount:result.withheld.length}));}
else{
 const state=await transport.read();const prepared=prepareFinanceFeed(input.evidence,input.mapping,state);const preview=await transport.preview(prepared.bundle);
 if(!preview.alreadyImported && (preview.possibleDuplicates!==0||preview.revision!==state.revision)) throw new Error('Preview needs duplicate or revision review.');
 console.log(JSON.stringify({preview:true,added:preview.added,posted:prepared.postedCount,pending:prepared.pendingCount,withheldCount:prepared.withheld.length,ledgerWritten:false}));
}
