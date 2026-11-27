import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {NotificationLibrary,notificationClientSnapshot} from '../apps/worker/dist/notification-library.js';
import {projectEvidence,changedEvidence,projectNow} from './project-notification-fixture.mjs';
import {pushFixture} from './notification-fixture.mjs';
async function setup(){const dir=await mkdtemp(join(tmpdir(),'fh-project-notices-')),file=join(dir,'notifications.json'),push=pushFixture('project-synthetic'),calls=[];const library=()=>new NotificationLibrary(file,async()=>push.config,async(...args)=>{calls.push(args);return 'accepted';});return {dir,file,calls,library,push};}
test('project source to durable notification: baseline, restart, read, late evidence, dedup and zero Push',async()=>{
 const s=await setup();let lib=s.library(),view=await lib.read();
 await lib.mutate({action:'enroll',expectedRevision:view.revision,permission:'granted',label:'Synthetic phone',subscription:s.push.subscription,publicKey:s.push.config.publicKey});
 const initial={vehicle:projectEvidence(),property:projectEvidence('property',1500000)},changed={vehicle:changedEvidence(),property:changedEvidence('property',1475000)},original=JSON.stringify(changed);
 assert.equal((await lib.scan({projects:initial},[],projectNow)).events.length,0);
 view=await lib.scan({projects:changed},[],projectNow);assert.equal(view.events.length,2);assert.ok(view.events.every(e=>e.kind==='project-price'&&!e.baseline&&e.active&&e.pushState==='handled'));assert.equal(view.preferences['project-price'],false);assert.equal('projectPrices' in view,false);
 const ids=view.events.map(e=>e.id),vehicle=view.events.find(e=>e.target.view==='vehicle');assert.equal(vehicle.target.recordId,'synthetic-vehicle');
 view=await lib.mutate({action:'read',id:vehicle.id,expectedRevision:view.revision},projectNow);
 lib=s.library();view=await lib.scan({projects:changed},[],projectNow);assert.deepEqual(view.events.map(e=>e.id),ids);assert.ok(view.events.find(e=>e.id===vehicle.id).readAt);
 const late=structuredClone(changed);late.vehicle.observations.splice(1,0,projectEvidence('vehicle',26500,'2026-11-23T11:30:00Z').observations[0]);
 view=await lib.scan({projects:late},[],projectNow);assert.deepEqual(view.events.map(e=>e.id),ids);assert.ok(view.events.find(e=>e.id===vehicle.id).readAt);assert.equal(JSON.stringify(changed),original);
 view=await lib.scan({projects:{property:changed.property}},['projet auto'],projectNow);assert.ok(view.events.find(e=>e.id===vehicle.id).active,'another domain cannot resolve an unavailable source');
 const noFollow=structuredClone(changed.vehicle);noFollow.followingHistory.push({requestId:'synthetic-stop',listingId:'synthetic-vehicle',followed:false,revision:2,recordedAt:'2026-11-23T15:00:00Z'});
 view=await lib.scan({projects:{vehicle:noFollow,property:changed.property}},[],projectNow);assert.equal(view.events.find(e=>e.id===vehicle.id).active,false);assert.ok(view.events.find(e=>e.target.view==='property').active);assert.deepEqual(s.calls,[]);
});
test('additive cursor/preferences preserve old history; old clients keep in-app-only category false',async()=>{
 const s=await setup(),lib=s.library();await lib.scan({projects:{vehicle:projectEvidence()}},[],projectNow);
 const saved=JSON.parse(await readFile(s.file,'utf8'));delete saved.projectPrices;delete saved.preferences['project-price'];await writeFile(s.file,JSON.stringify(saved));
 let view=await s.library().read();assert.equal(view.preferences['project-price'],false);const old={...view.preferences};delete old['project-price'];
 view=await lib.mutate({action:'preferences',preferences:old,expectedRevision:view.revision},projectNow);assert.equal(view.preferences['project-price'],false);
 await assert.rejects(()=>lib.mutate({action:'preferences',preferences:{...view.preferences,'project-price':true},expectedRevision:view.revision},projectNow),/dans l.application/);
 const bad=JSON.parse(await readFile(s.file,'utf8'));bad.projectPrices={'not-a-cursor':{}};await writeFile(s.file,JSON.stringify(bad));const bytes=await readFile(s.file);await assert.rejects(()=>s.library().read(),/illisible/);assert.deepEqual(await readFile(s.file),bytes);
});

test('invalid project proof preserves its previous alert while other sources progress',async()=>{
 const s=await setup(),lib=s.library();
 await lib.scan({projects:{vehicle:projectEvidence(),property:projectEvidence('property',1500000)}},[],projectNow);
 let view=await lib.scan({projects:{vehicle:changedEvidence()}},[],projectNow);
 const id=view.events[0].id;
 view=await lib.scan({projects:{vehicle:{observations:[{}],followingHistory:[]},property:changedEvidence('property',1475000)},collections:[{id:'synthetic',label:'Synthetic collector',state:'error'}]},[],projectNow);
 assert.ok(view.sourceErrors.includes('projet auto'));
 assert.ok(view.events.find(e=>e.id===id).active);
 assert.ok(view.events.some(e=>e.kind==='project-price'&&e.target.view==='property'&&e.active));
 assert.ok(view.events.some(e=>e.kind==='collection'));
});
test('legacy GET and mutation response projection hides additive kind without losing history or revision',async()=>{
 const s=await setup(),lib=s.library();await lib.scan({projects:{vehicle:projectEvidence()}},[],projectNow);
 let view=await lib.scan({projects:{vehicle:changedEvidence()},collections:[{id:'synthetic',label:'Synthetic collector',state:'error'}]},[],projectNow);
 const project=view.events.find(e=>e.kind==='project-price'),legacy=notificationClientSnapshot(view,false);
 assert.equal(legacy.events.some(e=>e.kind==='project-price'),false);assert.equal(legacy.events.length,1);assert.equal(legacy.revision,view.revision);
 assert.equal(notificationClientSnapshot(view,true),view);
 view=await lib.mutate({action:'read',id:legacy.events[0].id,expectedRevision:legacy.revision},projectNow);
 assert.equal(notificationClientSnapshot(view,false).events.length,1);assert.equal(view.events.find(e=>e.id===project.id).readAt,undefined);
 assert.equal((await lib.read()).events.length,2);
});

test('return to a previously notified price preserves its original read evidence without reactivation',async()=>{
 const s=await setup(),lib=s.library();await lib.scan({projects:{vehicle:projectEvidence()}},[],projectNow);
 let proof=changedEvidence(),view=await lib.scan({projects:{vehicle:proof}},[],projectNow),id=view.events[0].id;
 view=await lib.mutate({action:'read',id,expectedRevision:view.revision},projectNow);
 const original=view.events.find(e=>e.id===id);
 proof.observations.push(projectEvidence('vehicle',25000,'2026-11-23T13:00:00Z').observations[0]);
 await lib.scan({projects:{vehicle:proof}},[],projectNow);
 proof.observations.push(projectEvidence('vehicle',26500,'2026-11-23T14:00:00Z').observations[0]);
 view=await s.library().scan({projects:{vehicle:proof}},[],projectNow);
 assert.equal(view.events.length,2);
 assert.deepEqual(view.events.find(e=>e.id===id),{...original,active:false});
 assert.equal(view.events.some(e=>e.active),false);assert.deepEqual(s.calls,[]);
});
