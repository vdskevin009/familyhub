import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NotificationLibrary } from "../apps/worker/dist/notification-library.js";
import { notificationCandidates } from "../apps/worker/dist/notification-model.js";
import { buildMortgageDailyReport } from "../apps/worker/dist/mortgage-daily.js";
import { emptyMortgage, localDate } from "../apps/worker/dist/mortgage-model.js";
import { pushFixture } from "./notification-fixture.mjs";

const date = value => new Date(value);
const offer = { id: "synthetic-mortgage-offer", receivedDate: "2026-10-20", source: "Synthetic private quote", lender: "Synthetic private lender", product: "fixed-5", variant: "fixed", rate: 4, limitations: ["Synthetic only"] };
function daily(at, gain, previous = []) {
  const state = emptyMortgage(); state.quotes = [offer];
  return buildMortgageDailyReport({ state, now: date(at), previous, comparisons: [{ offerId: offer.id, status: "estimated", confirmed: false, netGain: gain, breakEvenMonths: 7, uncertainties: ["Synthetic private penalty assumption"], nextAction: "Review the private confirmation", endDate: "2027-12-01", validUntil: "2026-12-01" }] });
}
async function sandbox(run) { const directory=await mkdtemp(join(tmpdir(),"fh-mortgage-push-"));try {await run(join(directory,"history.json"));}finally{await rm(directory,{recursive:true,force:true});} }
async function setup(path, send, fixture=pushFixture()) {
  const library=new NotificationLibrary(path,async()=>fixture.config,send),state=await library.read();
  if(!state.devices.length)await library.mutate({action:"enroll",expectedRevision:state.revision,permission:"granted",label:"Synthetic phone",subscription:fixture.subscription,publicKey:fixture.config.publicKey});
  return {library,fixture};
}
const active = state => state.events.find(event=>event.active && event.kind==="mortgage");

test("mortgage baseline remains silent on refreshed days and delayed first enrollment",()=>sandbox(async path=>{
  let sends=0;const send=async()=>{sends++;return"accepted";};
  const first=daily("2026-10-22T17:00:00Z",2000),second=daily("2026-10-23T17:00:00Z",2000,[first]);
  assert.equal(first.signals[0].notify,false);assert.equal(second.signals[0].notify,false);
  const {library}=await setup(path,send);
  await library.scan({mortgage:[first]},[],date(first.generatedAt));
  const state=await library.scan({mortgage:[first,second]},[],date(second.generatedAt));
  assert.equal(sends,0);assert.equal(active(state).baseline,true);assert.equal(active(state).pushState,"handled");
  const material=daily("2026-10-23T18:00:00Z",3000,[first,second]);
  const late=await setup(path+".late",send);
  await late.library.scan({mortgage:[first,second,material]},[],date(material.generatedAt));
  assert.equal(sends,0,"first notification-source baseline never replays earlier report signals");
}));

test("mortgage pending material signal survives quiet hours and an unchanged next-day report",()=>sandbox(async path=>{
  const calls=[],send=async(...args)=>{calls.push(args);return"accepted";},t=await setup(path,send);
  const first=daily("2026-10-22T17:00:00Z",2000);
  await t.library.scan({mortgage:[first]},[],date(first.generatedAt));
  const material=daily("2026-10-23T06:00:00Z",3000,[first]);
  assert.equal(localDate(material.generatedAt),"2026-10-22");assert.equal(material.signals[0].notify,true);
  let state=await t.library.scan({mortgage:[first,material]},[],date(material.generatedAt));
  assert.equal(active(state).pushState,"pending");assert.equal(calls.length,0);const pendingId=active(state).id;
  const unchanged=daily("2026-10-23T14:00:00Z",3000,[first,material]);assert.equal(unchanged.signals[0].notify,false);
  state=await t.library.scan({mortgage:[first,material,unchanged]},[],date(unchanged.generatedAt));
  assert.equal(active(state).id,pendingId);assert.equal(active(state).pushState,"pending");assert.equal(calls.length,0);
  state=await t.library.scan({mortgage:[first,material,unchanged]},[],date("2026-10-23T15:00:00Z"));
  assert.equal(calls.length,1);assert.equal(calls[0][1],pendingId);assert.match(calls[0][1],/^[a-f0-9]{64}$/);
  assert.equal(active(state).pushState,"handled");
  const restarted=await setup(path,send,t.fixture),later=daily("2026-10-24T17:00:00Z",3000,[first,material,unchanged]);
  await restarted.library.scan({mortgage:[first,material,unchanged,later]},[],date(later.generatedAt));
  assert.equal(calls.length,1,"same material signal cannot replay after delivery or restart");
}));

test("daily budget defers mortgage until next eligible day despite ordinary report dedup",()=>sandbox(async path=>{
  const calls=[],t=await setup(path,async(_subscription,id)=>{calls.push(id);return"accepted";});
  const first=daily("2026-10-23T15:00:00Z",2000);
  await t.library.scan({mortgage:[first],collections:[]},[],date(first.generatedAt));
  const collection={id:"synthetic-source",label:"Synthetic source",state:"error",lastAttempt:"2026-10-23T16:00:00Z"};
  await t.library.scan({mortgage:[first],collections:[collection]},[],date("2026-10-23T16:00:00Z"));assert.equal(calls.length,1);
  const material=daily("2026-10-23T17:00:00Z",3000,[first]);
  let state=await t.library.scan({mortgage:[first,material],collections:[collection]},[],date(material.generatedAt));
  const pendingId=active(state).id;assert.equal(active(state).pushState,"pending");assert.equal(calls.length,1);
  const refreshed=daily("2026-10-23T18:00:00Z",3000,[first,material]);
  state=await t.library.scan({mortgage:[first,material,refreshed]},[],date(refreshed.generatedAt));assert.equal(active(state).pushState,"pending");
  const next=daily("2026-10-24T16:00:00Z",3000,[first,material,refreshed]);
  state=await t.library.scan({mortgage:[first,material,refreshed,next]},[],date(next.generatedAt));
  assert.equal(calls.length,2);assert.equal(calls[1],pendingId);assert.equal(active(state).pushState,"handled");
}));

test("missing current report defers pending mortgage; vanished opportunity expires it",()=>sandbox(async path=>{
  let sends=0;const t=await setup(path,async()=>{sends++;return"accepted";});
  const first=daily("2026-10-22T17:00:00Z",2000),material=daily("2026-10-23T06:00:00Z",3000,[first]);
  await t.library.scan({mortgage:[first]},[],date(first.generatedAt));
  let state=await t.library.scan({mortgage:[first,material]},[],date(material.generatedAt));const pendingId=active(state).id;
  state=await t.library.scan({mortgage:[first,material]},["mortgage"],date("2026-10-23T15:00:00Z"));
  assert.equal(sends,0);assert.equal(state.events.find(e=>e.id===pendingId).pushState,"pending");
  const gone=daily("2026-10-23T16:00:00Z",500,[first,material]);assert.equal(gone.signals.length,0);
  state=await t.library.scan({mortgage:[first,material,gone]},[],date(gone.generatedAt));
  assert.equal(sends,0);assert.equal(state.events.find(e=>e.id===pendingId).pushState,"expired");assert.equal(state.events.find(e=>e.id===pendingId).active,false);
}));

test("read and mortgage opt-out suppress deferred signals without later replay",()=>sandbox(async path=>{
  for(const action of ["read","preferences"]) {
    let sends=0;const t=await setup(path+action,async()=>{sends++;return"accepted";});
    const first=daily("2026-10-22T17:00:00Z",2000),material=daily("2026-10-23T06:00:00Z",3000,[first]);
    await t.library.scan({mortgage:[first]},[],date(first.generatedAt));
    let state=await t.library.scan({mortgage:[first,material]},[],date(material.generatedAt));
    state=await t.library.mutate(action==="read"?{action,id:active(state).id,expectedRevision:state.revision}:{action,preferences:{...state.preferences,mortgage:false},expectedRevision:state.revision},date(material.generatedAt));
    if(action==="preferences")state=await t.library.mutate({action,preferences:{...state.preferences,mortgage:true},expectedRevision:state.revision},date(material.generatedAt));
    const refresh=daily("2026-10-23T15:00:00Z",3000,[first,material]);
    await t.library.scan({mortgage:[first,material,refresh]},[],date(refresh.generatedAt));assert.equal(sends,0);
  }
}));

test("uncertain mortgage transport remains reserved across report refresh and restart",()=>sandbox(async path=>{
  let sends=0;const send=async()=>{sends++;const saved=JSON.parse(await readFile(path,"utf8"));assert.equal(saved.devices[0].lastDelivery.outcome,"unconfirmed");throw Error("Synthetic lost response");};
  const t=await setup(path,send),first=daily("2026-10-23T15:00:00Z",2000),material=daily("2026-10-23T16:00:00Z",3000,[first]);
  await t.library.scan({mortgage:[first]},[],date(first.generatedAt));
  let state=await t.library.scan({mortgage:[first,material]},[],date(material.generatedAt));
  assert.equal(sends,1);assert.equal(state.devices[0].lastDelivery.outcome,"unconfirmed");
  const restarted=await setup(path,send,t.fixture),refresh=daily("2026-10-24T16:00:00Z",3000,[first,material]);
  state=await restarted.library.scan({mortgage:[first,material,refresh]},[],date(refresh.generatedAt));
  assert.equal(sends,1);assert.equal(active(state).pushState,"handled");
}));

test("future report cannot establish present material delivery eligibility",()=>{
  const first=daily("2026-10-23T15:00:00Z",2000),future=daily("2026-10-23T18:00:00Z",3000,[first]);
  const candidates=notificationCandidates({mortgage:[first,future]},date("2026-10-23T16:00:00Z")).candidates;
  assert.equal(candidates.length,1);assert.equal(candidates[0].pushEligible,false);
});
