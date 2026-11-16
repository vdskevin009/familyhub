/** Existing daily research bridge: preview first, paired apply once, independent readback. No scraper/scheduler. */
import {readFile} from 'node:fs/promises';
import {validateVehicle} from '../apps/worker/dist/vehicle-project.js';
const args=process.argv.slice(2),option=k=>{const i=args.indexOf(k);return i<0?undefined:args[i+1];};
function canonical(v){if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';if(v&&typeof v==='object')return '{'+Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>JSON.stringify(k)+':'+canonical(x)).join(',')+'}';return JSON.stringify(v);}
async function main(){
 const path=option('--file');if(!path)throw Error('Provide --file private-observations.json [--apply --endpoint URL --key-file PATH]');
 const input=JSON.parse(await readFile(path,'utf8'));if(!Array.isArray(input)||input.length>100)throw Error('Expected at most 100 sourced observations');
 const records=input.map(validateVehicle);if(new Set(records.map(r=>r.id)).size!==records.length)throw Error('Duplicate observation IDs in input');
 if(records.some(r=>Buffer.byteLength(JSON.stringify(r))>32000))throw Error('An observation exceeds intake size');
 if(!args.includes('--apply')){console.log(JSON.stringify({preview:true,observations:records.length,writes:0}));return;}
 const endpoint=new URL(option('--endpoint')||'http://127.0.0.1:4713');
 if(endpoint.protocol!=='https:'&&!(endpoint.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname)))throw Error('Use existing paired localhost/private HTTPS endpoint');
 if(endpoint.username||endpoint.password||endpoint.search||endpoint.hash||endpoint.pathname!=='/')throw Error('Endpoint must be an origin');
 const keyPath=option('--key-file');if(!keyPath)throw Error('Existing pairing key file required');const key=(await readFile(keyPath,'utf8')).trim();if(!key)throw Error('Empty pairing key');
 const headers={'x-familyhub-key':key};
 async function read(){const r=await fetch(new URL('/vehicle-project',endpoint),{headers,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error(`Private read refused (${r.status}); no replay`);const s=await r.json();if(!Array.isArray(s.observations))throw Error('Invalid vehicle snapshot');return s.observations.map(validateVehicle);}
 const h=await fetch(new URL('/health',endpoint),{headers,redirect:'error',signal:AbortSignal.timeout(10000)});if(!h.ok||!(await h.json()).capabilities?.includes('vehicle-project-v1'))throw Error('Vehicle capability unavailable; no write');
 let existing=await read(),stored=0,duplicates=0;
 // Validate the whole batch against baseline before any write.
 for(const record of records){const old=existing.find(r=>r.id===record.id);if(old&&canonical(old)!==canonical(record))throw Error('Observation ID conflict; no batch write');}
 for(const record of records){
  if(existing.some(r=>r.id===record.id)){duplicates++;continue;}
  let failure=false;
  try{const r=await fetch(new URL('/vehicle-project/observations',endpoint),{method:'POST',headers:{...headers,'content-type':'application/json'},redirect:'error',body:JSON.stringify(record),signal:AbortSignal.timeout(15000)});failure=!r.ok;}catch{failure=true;}
  // A lost/failed response is never retried: read actual persisted evidence first.
  existing=await read();const actual=existing.find(r=>r.id===record.id);
  if(!actual||canonical(actual)!==canonical(record))throw Error(failure?'Write uncertain or refused; no replay. Inspect persisted evidence before retry.':'Independent readback did not match; no replay');
  stored++;
 }
 console.log(JSON.stringify({verified:true,stored,duplicates,observations:records.length}));
}
await main().catch(e=>{console.error(e.message);process.exitCode=1;});
