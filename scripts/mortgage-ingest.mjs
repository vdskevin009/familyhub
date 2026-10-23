/** Validate evidence, or send it once to the existing paired worker. No scheduler or source scraper. */
import { readFile } from "node:fs/promises";
import { validateSnapshot, validateQuote, validateAssumptions, validateState } from "../apps/worker/dist/mortgage-model.js";
import { validateContact } from "../apps/worker/dist/mortgage-contacts.js";
const args=process.argv.slice(2), option=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
async function main() {
  const kind=option("--kind"), file=option("--file");
  let record;
  if(!args.includes("--preflight")) {
    if(!["snapshot","quote","assumptions","contact"].includes(kind) || !file) throw Error("Usage: --kind snapshot|quote|assumptions|contact --file PATH [--apply --endpoint URL --key-file PATH], or --preflight --endpoint URL --key-file PATH");
    const value=JSON.parse(await readFile(file,"utf8")); record=kind==="snapshot"?validateSnapshot(value):kind==="quote"?validateQuote(value):kind==="contact"?validateContact(value):validateAssumptions(value);
    if(!args.includes("--apply")) { console.log("Evidence valid. No write requested."); return; }
  }
  const endpoint=new URL(option("--endpoint") || "http://127.0.0.1:4713");
  if(endpoint.protocol!=="https:" && !(endpoint.protocol==="http:" && ["127.0.0.1","localhost","[::1]"].includes(endpoint.hostname))) throw Error("Use localhost or the existing private HTTPS endpoint");
  if(endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname!=="/") throw Error("Endpoint must be an origin");
  const keyPath=option("--key-file"); if(!keyPath) throw Error("Existing pairing key file required");
  const key=(await readFile(keyPath,"utf8")).trim(); if(!key) throw Error("Empty pairing key");
  if(args.includes("--preflight")) {
    const health=await fetch(new URL("/health",endpoint),{headers:{"x-familyhub-key":key},signal:AbortSignal.timeout(10000)});
    if(!health.ok || !(await health.json()).capabilities?.includes("mortgage-evidence-v1")) throw Error("Mortgage capability unavailable on this worker; authorized update/restart required");
    const response=await fetch(new URL("/mortgage",endpoint),{headers:{"x-familyhub-key":key},cache:"no-store",signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw Error(`Read-only preflight refused (${response.status})`);
    const state=validateState(await response.json());console.log(JSON.stringify({readOnly:true,schema:state.schema,baselineDate:state.baselineDate,baselineFrozen:state.baselineSnapshotId!==null,snapshots:state.snapshots.length,quotes:state.quotes.length,assumptions:state.assumptions.length}));return;
  }
  const extended=kind==="contact" || kind==="quote" && ["contactId","cashback","status","supersedes"].some(k=>record[k]!==undefined);
  if(extended){
    const health=await fetch(new URL("/health",endpoint),{headers:{"x-familyhub-key":key},signal:AbortSignal.timeout(10000)});
    if(!health.ok || !(await health.json()).capabilities?.includes("mortgage-contacts-v1")) throw Error("Contact/offer metadata capability unavailable; no write requested. Authorized worker update required.");
    const preflight=await fetch(new URL("/mortgage",endpoint),{headers:{"x-familyhub-key":key},cache:"no-store",signal:AbortSignal.timeout(10000)});
    if(!preflight.ok) throw Error("Mortgage read preflight failed; no write requested"); validateState(await preflight.json());
  }
  let response;
  try { response=await fetch(new URL(kind==="snapshot"?"/mortgage/snapshots":kind==="quote"?"/mortgage/quotes":kind==="contact"?"/mortgage/contacts":"/mortgage/assumptions",endpoint),{method:"POST",headers:{"content-type":"application/json","x-familyhub-key":key},body:JSON.stringify(record),signal:AbortSignal.timeout(30000)}); }
  catch { throw Error("Write outcome uncertain. Query GET /mortgage for the same ID before retrying the identical record. No automatic replay occurred."); }
  if(!response.ok) throw Error(`Worker returned ${response.status}. Read GET /mortgage for this ID before retrying the identical evidence; existing records are preserved.`);
  console.log((await response.json()).duplicate?"Already stored; no duplicate created.":"Evidence stored by paired worker.");
}
await main().catch(e=>{ console.error(e.message); process.exitCode=1; });
