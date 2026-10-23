import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateContact, currentContacts } from "../apps/worker/src/mortgage-contacts.ts";
import { validateQuote } from "../apps/worker/src/mortgage-model.ts";
import { emptyMortgage } from "../apps/worker/src/mortgage-model.ts";
import { MortgageStore } from "../apps/worker/src/mortgage-store.ts";
import { quote } from "./mortgage-fixture.ts";
const contact = (id="synthetic-contact-v1", recordedAt="2026-01-02T12:00:00Z") => ({id,contactId:"synthetic-person",recordedAt,name:"Synthetic contact",organization:"Synthetic broker",status:"appointment" as const,source:"SYNTHETIC_EVIDENCE",notes:[],appointment:{startsAt:"2026-01-05T18:00:00Z",endsAt:"2026-01-05T18:20:00Z",source:"Synthetic invitation"}});

test("contact revisions are private dated evidence with validated appointments",()=>{
  const first=contact(),next={...contact("synthetic-contact-v2","2026-01-03T12:00:00Z"),status:"paused" as const};assert.deepEqual(validateContact(first),first);assert.deepEqual(currentContacts([next,first]),[next]);assert.throws(()=>validateContact({...first,appointment:null}));assert.throws(()=>validateContact({...first,appointment:{...first.appointment,endsAt:first.appointment.startsAt}}));
});

test("remises are option-specific and distinguish cashback from a total incentive",()=>{
  const base=quote("adjustable-payment"),one={...base,cashback:{amount:1700,basis:"cashback" as const,conditions:["Synthetic eligibility conditions"]}},two={...quote("fixed-payment"),cashback:{amount:2900,basis:"total-incentive" as const,conditions:["Synthetic total includes distinct components"]}};assert.equal(validateQuote(one).cashback!.amount,1700);assert.equal(validateQuote(two).cashback!.amount,2900);assert.equal(validateQuote(base).cashback,undefined);assert.doesNotThrow(()=>validateQuote({...base,variant:"unconfirmed-payment"}));assert.throws(()=>validateQuote({...quote(),variant:"unconfirmed-payment"}));assert.throws(()=>validateQuote({...one,cashback:{...one.cashback,conditions:[]}}));assert.throws(()=>validateQuote({...one,cashback:{...one.cashback,amount:-1}}));
});

test("contact and offer revisions persist idempotently without modifying old evidence or baseline",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"fh-mortgage-contacts-")),store=new MortgageStore(directory);
  try{const first=contact();assert.equal((await store.ingest("contact",first)).duplicate,false);assert.equal((await store.ingest("contact",first)).duplicate,true);await assert.rejects(store.ingest("contact",{...first,name:"Changed without revision"}));const legacy=quote("adjustable-payment");await store.ingest("quote",legacy);const next={...legacy,id:"synthetic-offer-revision",contactId:first.contactId,supersedes:legacy.id,cashback:{amount:1700,basis:"cashback",conditions:["Synthetic only"]}};await store.ingest("quote",next);assert.equal((await store.ingest("quote",next)).duplicate,true);const state=await new MortgageStore(directory).read();assert.equal(state.quotes.length,2);assert.deepEqual(state.quotes.find(q=>q.id===legacy.id),legacy);assert.equal(state.baselineSnapshotId,null);await assert.rejects(store.ingest("quote",{...next,id:"dangling-contact",contactId:"unknown"}));assert.equal((await store.read()).quotes.length,2);}finally{await rm(directory,{recursive:true,force:true});}
});

test("CLI contact metadata requires installed capability and read-only preflight before its single write",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"fh-contact-cli-")),events:string[]=[],file=join(directory,"contact.json"),key=join(directory,"key.txt");let enabled=false;
  await writeFile(file,JSON.stringify(contact()));await writeFile(key,"synthetic-cli-key");
  const server=createServer((req,res)=>{events.push(req.method+" "+req.url);res.setHeader("Content-Type","application/json");if(req.url==="/health")res.end(JSON.stringify({capabilities:enabled?["mortgage-evidence-v1","mortgage-contacts-v1"]:["mortgage-evidence-v1"]}));else if(req.url==="/mortgage")res.end(JSON.stringify(emptyMortgage()));else if(req.url==="/mortgage/contacts"&&req.method==="POST")res.end('{"duplicate":false}');else{res.statusCode=404;res.end('{}');}});server.listen(0,"127.0.0.1");await once(server,"listening");
  try{const run=()=>promisify(execFile)(process.execPath,["scripts/mortgage-ingest.mjs","--kind","contact","--file",file,"--apply","--endpoint",`http://127.0.0.1:${(server.address() as any).port}`,"--key-file",key],{windowsHide:true});await assert.rejects(run());assert.deepEqual(events,["GET /health"]);events.length=0;enabled=true;const output=await run();assert.doesNotMatch(output.stdout+output.stderr,/synthetic-cli-key/);assert.deepEqual(events,["GET /health","GET /mortgage","POST /mortgage/contacts"]);}finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(directory,{recursive:true,force:true});}
});
