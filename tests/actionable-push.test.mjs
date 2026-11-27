import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
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

test('compatible disk extension isolates new types and preserves all 500 legacy events and shared controls', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'familyhub-action-retention-'));
  const path = join(dir, 'state.json');
  const fixtureTime = projectNow.toISOString();
  const legacy = Array.from({ length: 500 }, (_, i) => ({
    id: (i + 1).toString(16).padStart(64, '0'), kind: 'collection', title: 'Legacy fixture',
    detail: 'Synthetic', target: { view: 'reimbursements' }, active: true, baseline: true,
    createdAt: new Date(+projectNow - 2000 + i).toISOString(), pushState: 'handled',
  }));
  const unexpected = [];
  const lib = new NotificationLibrary(path, async () => null, async (...args) => { unexpected.push(args); throw Error('Unexpected transport'); });
  try {
    const empty = await lib.read();
    const preferences = Object.fromEntries(Object.entries(empty.preferences).filter(([kind]) => !['open-claim','new-property','new-vehicle'].includes(kind)));
    const state = { schema: 1, revision: 'legacy', events: legacy, seen: legacy.map(e => e.id), preferences,
      initialized: ['collections'], devices: [], sourceErrors: [], lastAutomaticPushAt: fixtureTime };
    await writeFile(path, JSON.stringify(state));
    await lib.scan({ projects: { property: { observations: [] } } }, [], projectNow);
    const initial = await lib.read();
    await lib.mutate({ action: 'preferences', preferences: { ...initial.preferences, 'new-property': true }, expectedRevision: initial.revision }, projectNow);
    const after = await lib.scan({ projects: { property: projectEvidence('property', 1250000) } }, [], projectNow);
    const event = after.events.find(e => e.kind === 'new-property');
    const saved = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(after.events.length, 501);
    assert.deepEqual(saved.events, legacy);
    assert.deepEqual(saved.preferences, preferences);
    assert.deepEqual(saved.initialized, ['collections']);
    assert.deepEqual(saved.actionableAlerts.initialized, ['new-property']);
    assert.deepEqual(Object.keys(saved.actionableAlerts.preferences).sort(), ['new-property','new-vehicle','open-claim']);
    assert.equal(saved.actionableAlerts.events[0].id, event.id);
    assert.equal(saved.lastAutomaticPushAt, fixtureTime);
    assert.ok(saved.seen.includes(event.id));
    assert.deepEqual(notificationClientSnapshot(after, false).events.map(e => e.id), legacy.map(e => e.id));
    assert.equal(notificationClientSnapshot(after, true).events.length, 500);
    assert.ok(notificationClientSnapshot(after, true).events.some(e => e.id === event.id));
    assert.deepEqual(unexpected, []);

    const invalid = JSON.stringify({ ...saved, actionableAlerts: { ...saved.actionableAlerts, schema: 99 } });
    await writeFile(path, invalid);
    await assert.rejects(() => lib.read(), /Historique de notifications illisible/);
    assert.equal(await readFile(path, 'utf8'), invalid);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('installed-generation worker can mutate and scan between two new-worker sessions without dropping state or sending',
  { skip: !process.env.FAMILYHUB_LEGACY_NOTIFICATION_LIBRARY }, async () => {
  const { NotificationLibrary: Legacy } = await import(pathToFileURL(process.env.FAMILYHUB_LEGACY_NOTIFICATION_LIBRARY).href);
  const dir = await mkdtemp(join(tmpdir(), 'familyhub-action-old-new-old-'));
  const path = join(dir, 'state.json'), sent = [];
  const { config, subscription } = pushFixture();
  const configuration = async () => config;
  const transport = async (...args) => { sent.push(args); return 'accepted'; };
  const persisted = async () => JSON.parse(await readFile(path, 'utf8'));
  const legacy = new Legacy(path, configuration, transport);
  const newWorker = () => new NotificationLibrary(path, configuration, transport);
  const collections = [{ id: 'synthetic-collector', label: 'Synthetic collection', state: 'error' }];
  try {
    let before = await legacy.scan({ collections }, [], projectNow);
    before = await legacy.mutate({ action: 'enroll', subscription, publicKey: config.publicKey, label: 'Fixture', permission: 'granted', expectedRevision: before.revision }, projectNow);
    const seeded = { ...await persisted(), lastAutomaticPushAt: projectNow.toISOString(), unrelatedFixture: { keep: true } };
    await writeFile(path, JSON.stringify(seeded));

    let next = newWorker();
    let current = await next.scan({ collections, projects: { property: { observations: [] } } }, [], projectNow);
    current = await next.mutate({ action: 'preferences', preferences: { ...current.preferences, 'new-property': true }, expectedRevision: current.revision }, projectNow);
    const matching = { collections, projects: { property: projectEvidence('property', 1250000) } };
    current = await next.scan(matching, [], projectNow);
    const event = current.events.find(e => e.kind === 'new-property');
    const legacyId = current.events.find(e => e.kind === 'collection').id;
    assert.equal(event.pushState, 'pending', 'Existing daily budget prevents this otherwise eligible event');
    assert.equal(sent.length, 0);
    current = await next.mutate({ action: 'read', id: event.id, expectedRevision: current.revision }, projectNow);
    current = await next.scan(matching, [], projectNow);
    assert.equal(current.events.find(e => e.id === event.id).pushState, 'handled');
    const upgrade = await persisted();

    const rollback = await legacy.read();
    assert.ok(rollback.events.some(e => e.id === legacyId));
    assert.ok(!rollback.events.some(e => e.id === event.id));
    const changed = await legacy.mutate({ action: 'preferences', preferences: { ...rollback.preferences, collection: false }, expectedRevision: rollback.revision }, projectNow);
    await legacy.mutate({ action: 'read', id: legacyId, expectedRevision: changed.revision }, projectNow);
    await legacy.scan({ collections }, [], projectNow);
    const afterRollback = await persisted();
    assert.deepEqual(afterRollback.actionableAlerts, upgrade.actionableAlerts);
    assert.deepEqual(afterRollback.seen, upgrade.seen);
    assert.deepEqual(afterRollback.devices, seeded.devices);
    assert.deepEqual(afterRollback.unrelatedFixture, seeded.unrelatedFixture);
    assert.equal(afterRollback.lastAutomaticPushAt, seeded.lastAutomaticPushAt);

    next = newWorker();
    current = await next.scan(matching, [], projectNow);
    assert.equal(current.preferences.collection, false);
    assert.equal(current.preferences['new-property'], true);
    assert.ok(current.events.find(e => e.id === legacyId).readAt);
    assert.ok(current.events.find(e => e.id === event.id).readAt);
    assert.equal(current.events.find(e => e.id === event.id).pushState, 'handled');
    assert.equal(current.events.filter(e => e.id === event.id).length, 1);
    assert.deepEqual(sent, []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
