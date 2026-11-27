import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {NotificationLibrary,notificationClientSnapshot} from '../apps/worker/dist/notification-library.js';
import {newProjectActions,openClaimActions} from '../apps/worker/dist/actionable-projects.js';
import {projectEvidence,projectNow} from './actionable-notification-fixture.mjs';
import {pushFixture} from './notification-fixture.mjs';

test('a new qualifying property uses the opted-in phone path once, with opaque ID, silent baseline and exact destination',async()=>{
  const temp=await mkdtemp(join(tmpdir(),'familyhub-action-test-'));
  const sent=[],{config,subscription}=pushFixture();
  const make=()=>new NotificationLibrary(join(temp,'state.json'),async()=>config,async(_sub,id)=>{sent.push(id);return 'accepted';});
  try {
    let lib=make(),view=await lib.scan({projects:{property:{observations:[],followingHistory:[]}}},[],projectNow);
    assert.equal(view.preferences['new-property'],false);
    view=await lib.mutate({action:'enroll',subscription,publicKey:config.publicKey,label:'Fixture',permission:'granted',expectedRevision:view.revision},projectNow);
    view=await lib.mutate({action:'preferences',preferences:{...view.preferences,'new-property':true},expectedRevision:view.revision},projectNow);
    const evidence={projects:{property:projectEvidence('property',1250000)}};
    view=await lib.scan(evidence,[],projectNow);
    const item=view.events.find(e=>e.kind==='new-property');
    assert.deepEqual(sent,[item.id]);assert.match(item.id,/^[a-f0-9]{64}$/);
    assert.deepEqual(item.target,{view:'property',recordId:'synthetic-property'});
    assert.equal(notificationClientSnapshot(view,false).events.some(e=>e.id===item.id),false);
    assert.equal(notificationClientSnapshot(view,true).events.some(e=>e.id===item.id),true);
    lib=make();await lib.scan(evidence,[],projectNow);assert.equal(sent.length,1);
  } finally {await rm(temp,{recursive:true,force:true});}
});
test('disabled discoveries cannot be replayed by a later opt-in',async()=>{
  const temp=await mkdtemp(join(tmpdir(),'familyhub-disabled-test-'));
  const {config}=pushFixture(),lib=new NotificationLibrary(join(temp,'state.json'),async()=>config,async()=>{throw Error('Unexpected send');});
  try {
    const proof={projects:{property:projectEvidence('property',1250000)}};
    let view=await lib.scan(proof,[],projectNow);
    assert.equal(view.events.filter(e=>e.kind==='new-property').length,0);
    await lib.mutate({action:'preferences',preferences:{...view.preferences,'new-property':true},expectedRevision:view.revision},projectNow);
    view=await lib.scan(proof,[],projectNow);
    assert.equal(view.events.filter(e=>e.kind==='new-property').length,0);
  } finally {await rm(temp,{recursive:true,force:true});}
});
test('unknown, too old, future, or same-time ambiguous project evidence cannot alert',()=>{
  const p=projectEvidence('property',1250000);
  for(const transform of [r=>r.separateEntrances.value=null,r=>r.status='sold',r=>r.priceCad.checkedAt='2026-10-01T10:00:00Z']){
    const v=structuredClone(p);transform(v.observations[0]);
    if(v.observations[0].separateEntrances.value===null)v.observations[0].separateEntrances={value:null,checkedAt:null,sourceUrl:null,note:''};
    if(v.observations[0].status==='sold')v.observations[0].statusEvidence.value='sold';
    assert.equal(newProjectActions('property',v,projectNow).length,0);
  }
  const changed=structuredClone(p.observations[0]);
  changed.id+='-correction';changed.observedAt=projectNow.toISOString();changed.priceCad.value+=100;
  assert.equal(newProjectActions('property',{...p,observations:[p.observations[0],changed]},projectNow).length,0);
  assert.equal(newProjectActions('property',p,new Date('2026-11-20')).length,0);
  assert.equal(newProjectActions('property',{...p,observations:[...p.observations,...p.observations]},projectNow).length,0);
});
test('auto requires three distinct lower-bound comparisons, exact trim, documented AWD and fresh mileage',()=>{
  function car(i){
    const r=projectEvidence('vehicle',i===0?22500:25000).observations[0];
    r.id+=i;r.listingId+=i;r.url+=i;
    r.priceCad.sourceUrl=r.url;r.awd={...r.used,value:true};
    return r;
  }
  const set={observations:[0,1,2,3].map(car),followingHistory:[]};
  assert.equal(newProjectActions('vehicle',set,projectNow).length,1);
  assert.equal(newProjectActions('vehicle',set,projectNow)[0].links.length,3);
  for(const transform of [r=>r.priceCad.value=22500.01,r=>r.trim.value='other',r=>r.mileageKm.value+=10001]){
    const v=structuredClone(set);transform(v.observations[0]);assert.equal(newProjectActions('vehicle',v,projectNow).length,0);
  }
  set.observations[2].priceCad.sourceUrl=set.observations[1].priceCad.sourceUrl;
  assert.equal(newProjectActions('vehicle',set,projectNow).length,0);
});
test('14 days is aged workflow evidence, never a presumed insurer submission or payment',()=>{
  const since=new Date(+projectNow-14*86400000).toISOString();
  const s={lastSuccess:projectNow.toISOString(),coverage:{complete:true,heldMessages:0},items:[{Id:'e'}],reconciliations:[{Id:'c',ExpenseDocumentId:'e',WorkflowChangedAt:since,WorkflowStatus:'open',Status:'waiting-primary',PotentialRemaining:10}]};
  const [c]=openClaimActions(s,projectNow);
  assert.equal(c.kind,'open-claim');assert.equal(c.target.recordId,'c');
  assert.deepEqual(openClaimActions({...s,reconciliations:[{...s.reconciliations[0],WorkflowChangedAt:new Date(Date.parse(since)+1).toISOString()}]},projectNow),[]);
  assert.deepEqual(openClaimActions({...s,reconciliations:[{...s.reconciliations[0],WorkflowStatus:'closed'}]},projectNow),[]);
  assert.equal(openClaimActions({...s,coverage:{complete:false,heldMessages:1}},projectNow),undefined);
});
