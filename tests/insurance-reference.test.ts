import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newContract, publicBaseline, baselineKey } from "../apps/worker/src/savings-model.ts";
import { validateInsuranceReference, insuranceExport } from "../apps/worker/src/insurance-reference.ts";
import { validateContract } from "../apps/worker/src/savings-sharing-model.ts";
import { SavingsLibrary } from "../apps/worker/src/savings-library.ts";
import { savingsPrompt } from "../apps/worker/src/savings-research.ts";
// @ts-expect-error JavaScript synthetic fixture shared with browser acceptance
import { syntheticInsuranceReference } from "./fixtures/insurance-reference.mjs";
test("insurance reference preserves unknowns, historic membership and unsent quote requests", () => {
  const ref=syntheticInsuranceReference(); assert.deepEqual(validateInsuranceReference(ref),ref); assert.equal(ref.records[0].facts[3].value,null); assert.equal(ref.records[1].status,'historical'); assert.equal(ref.records[2].quotedAnnualPremium,null);
  for(const change of [(r:any)=>r.records[0].facts[3].value=0,(r:any)=>r.records[0].effectiveTo='2026-02-30',(r:any)=>r.records[0].facts[0].sourceIds=['absent'],(r:any)=>r.records[2].quotedAnnualPremium=10,(r:any)=>r.records[0].facts.push(r.records[0].facts[0])]){const bad=structuredClone(ref);change(bad);assert.throws(()=>validateInsuranceReference(bad));}
});
test("advertisements cannot masquerade as received quotes or a reviewed comparable policy",()=>{
  const ref=syntheticInsuranceReference(),r=ref.records[2];r.kind='quote';r.status='received';r.receivedOn='2026-01-02';ref.sources[0].kind='public';ref.sources[0].scope='advertisement';assert.throws(()=>validateInsuranceReference(ref));ref.sources[0].kind='gmail';ref.sources[0].scope='quote';assert.doesNotThrow(()=>validateInsuranceReference(ref));r.comparison='reviewed-comparable';assert.throws(()=>validateInsuranceReference(ref));
});

test("awaiting quotes keep acknowledgements separate from dated offers",()=>{
  const ref=syntheticInsuranceReference(),request=ref.records[2];request.status='awaiting_quote';request.requestedOn='2026-01-02';assert.doesNotThrow(()=>validateInsuranceReference(ref));request.receivedOn='2026-01-03';assert.throws(()=>validateInsuranceReference(ref));request.receivedOn=null;request.requestedOn=null;assert.throws(()=>validateInsuranceReference(ref));
});
test("private policy identifiers and facts never enter public research; local comparisons invalidate on changes",()=>{
  const c={...newContract('home-insurance','synthetic'),name:'Synthetic policy contract',updatedAt:'2026-01-02T12:00:00Z',insuranceReference:syntheticInsuranceReference()};const key=baselineKey(c),publicInput=JSON.stringify(publicBaseline(c))+savingsPrompt(publicBaseline(c));assert.ok(!publicInput.includes('SYNTHETIC_PRIVATE_REFERENCE'));assert.ok(!publicInput.includes('insuranceReference'));const changed=structuredClone(c);changed.insuranceReference.records[0].facts[0].value=50000;assert.notEqual(baselineKey(changed),key);const exported=insuranceExport(c);assert.deepEqual(exported.reference,c.insuranceReference);assert.ok(!JSON.stringify(exported).includes('ApiKey'));assert.deepEqual(validateContract(c).insuranceReference,c.insuranceReference);
});
test("shared insurance history survives restart, duplicate replay and older editors; conflicting evidence is preserved",async()=>{
  const dir=await mkdtemp(join(tmpdir(),'fh-insurance-')),path=join(dir,'contracts.json'),store=new SavingsLibrary(path),c={...newContract('home-insurance','synthetic'),name:'Synthetic insurance',updatedAt:'2026-01-02T12:00:00Z',insuranceReference:syntheticInsuranceReference()};
  try{const first=await store.import({contracts:[c],documents:[]});const bytes=await readFile(path,'utf8');await store.import({contracts:[c],documents:[]});assert.equal(await readFile(path,'utf8'),bytes);const legacy={...c};delete (legacy as any).insuranceReference;const saved=await store.update(c.id,{contract:legacy,expectedRevision:first.records[0].revision,documents:[]});assert.equal(await readFile(path,'utf8'),bytes);assert.deepEqual((await new SavingsLibrary(path).list()).records[0].contract.insuranceReference,c.insuranceReference);const bad=structuredClone(c);bad.insuranceReference.records[0].facts[0].value=999;await assert.rejects(store.update(c.id,{contract:bad,expectedRevision:saved.records[0].revision,documents:[]}));assert.equal(await readFile(path,'utf8'),bytes);await assert.rejects(store.update(c.id,{contract:c,expectedRevision:'stale',documents:[]}));}finally{await rm(dir,{recursive:true,force:true});}
});
