import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PropertyStore, PropertyConflict, validateProperty, propertyCard } from '../apps/worker/src/property-project.ts';
const at='2026-11-16T10:00:00Z';
const fact=(value:any)=>({value,sourceUrl:value===null?null:'https://example.com/listing',checkedAt:value===null?null:at,note:'Synthetic source'});
const fixture=()=>({id:'observation-1',listingId:'synthetic-listing',observedAt:at,address:'Synthetic address',url:'https://example.com/listing',status:'active',statusEvidence:fact('active'),priceCad:fact(1600000),bedrooms:fact(3),lowerLonsdale:fact(true),separateEntrances:fact(true),airbnb:{status:'unknown',evidence:[]}});
test('all four criteria evidenced; opportunity never fabricated',()=>{const c=propertyCard(fixture(),new Date(at));assert.equal(c.matchPercent,100);assert.equal(c.available,true);assert.equal(c.opportunity.score,null);});
test('unknown entrance is not a match or failure',()=>{const p=fixture();p.separateEntrances=fact(null);const c=propertyCard(p,new Date(at));assert.equal(c.matchPercent,null);assert.equal(c.evidenceCoveragePercent,75);assert.equal(c.eligibility,'needs-verification');});
test('hard mismatch remains visible; stale listing is not available',()=>{const p=fixture();p.priceCad=fact(1700001);const c=propertyCard(p,new Date('2026-11-20T10:00:00Z'));assert.equal(c.matchPercent,75);assert.equal(c.eligibility,'does-not-match');assert.equal(c.available,false);});
test('unproven facts, credential links and blanket Airbnb permission rejected',()=>{const p=fixture();p.bedrooms.sourceUrl=null;assert.throws(()=>validateProperty(p));assert.throws(()=>validateProperty({...fixture(),url:'https://user:secret@example.com/'}));assert.throws(()=>validateProperty({...fixture(),airbnb:{status:'permitted',evidence:[]}}));});
test('extra fields stripped and source dates cannot be later than observation',()=>{assert.equal('secret' in validateProperty({...fixture(),secret:'never persist'}),false);const p=fixture();p.priceCad.checkedAt='2026-11-17T00:00:00Z';assert.throws(()=>validateProperty(p));});
test('immutable idempotent history, conflicts, latest per listing and restart',async()=>{const dir=await mkdtemp(join(tmpdir(),'fh-property-test-'));const s=new PropertyStore(dir);assert.deepEqual(await s.read(),{observations:[],cards:[],followingHistory:[],followingRevision:0});assert.deepEqual(await s.ingest(fixture()),{duplicate:false});assert.deepEqual(await s.ingest(fixture()),{duplicate:true});const p=fixture();p.priceCad=fact(1500000);await assert.rejects(s.ingest(p),PropertyConflict);p.id='observation-2';p.observedAt='2026-11-17T10:00:00Z';await s.ingest(p);const r=await new PropertyStore(dir).read(new Date(p.observedAt));assert.equal(r.observations.length,2);assert.equal(r.cards.length,1);assert.equal(r.cards[0].priceCad.value,1500000);});
test('corrupt history fails closed',async()=>{const dir=await mkdtemp(join(tmpdir(),'fh-property-bad-'));await writeFile(join(dir,'observation-'+'a'.repeat(64)+'.json'),'bad');await assert.rejects(new PropertyStore(dir).read());});

test('photo absent is explicit, supplied photo requires safe attributed source',()=>{assert.equal(validateProperty(fixture()).primaryPhoto,null);assert.throws(()=>validateProperty({...fixture(),primaryPhoto:{url:'javascript:bad',sourceUrl:'https://example.com',attribution:'Source',checkedAt:at}}));});

test('isolated worker HTTP respects pairing, origin, payload limits and idempotence', async()=>{
 const {spawn}=await import('node:child_process');const {createServer}=await import('node:net');const {once}=await import('node:events');
 const dir=await mkdtemp(join(tmpdir(),'fh-property-http-'));await writeFile(join(dir,'pairing-key.txt'),'synthetic-property-key');
 const reserve=createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const port=(reserve.address() as any).port;await new Promise<void>(r=>reserve.close(()=>r()));
 const child=spawn(process.execPath,['--import','tsx','apps/worker/src/index.ts'],{windowsHide:true,env:{...process.env,FAMILYHUB_WORKER_DATA:dir,FAMILYHUB_WORKER_HOST:'127.0.0.1',FAMILYHUB_WORKER_PORT:String(port)},stdio:['ignore','pipe','pipe']});let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
 const endpoint=`http://127.0.0.1:${port}/property-project`;const headers={'x-familyhub-key':'synthetic-property-key',origin:'https://vdskevin009.github.io','content-type':'application/json'};
 const post=(p:any)=>fetch(endpoint+'/observations',{method:'POST',headers,body:JSON.stringify(p)});
 try {
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(endpoint,{headers})).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(ready,'isolated worker startup: '+logs);
  assert.equal((await fetch(endpoint)).status,401);assert.equal((await fetch(endpoint,{headers:{...headers,origin:'https://evil.example'}})).status,403);
  assert.equal((await fetch(endpoint,{headers})).headers.get('cache-control'),'no-store');
  assert.equal((await post(fixture())).status,200);assert.deepEqual(await (await post(fixture())).json(),{duplicate:true});
  assert.equal((await post({...fixture(),address:'Conflicting address'})).status,409);
  assert.equal((await post({...fixture(),extra:'x'.repeat(33000)})).status,400);
  const state=await (await fetch(endpoint,{headers})).json();assert.equal(state.cards.length,1);assert.equal(state.observations.length,1);
  const following={requestId:'http-follow',listingId:'synthetic-listing',followed:true,expectedRevision:0};
  assert.equal((await fetch(endpoint+'/following',{method:'POST',body:JSON.stringify(following)})).status,401);
  assert.equal((await fetch(endpoint+'/following',{method:'POST',headers,body:JSON.stringify(following)})).status,200);
  assert.equal((await (await fetch(endpoint,{headers})).json()).cards[0].followed,true);
  assert.equal((await fetch(endpoint+'/following',{method:'POST',headers,body:JSON.stringify({...following,requestId:'stale',followed:false})})).status,409);
 }finally {if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}}
});

test('following survives sold/unknown transitions and restarts; vanished listing not erased',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'fh-property-follow-'));const s=new PropertyStore(dir);await s.ingest(fixture());
 assert.deepEqual(await s.setFollowing({requestId:'follow-1',listingId:'synthetic-listing',followed:true,expectedRevision:0}),{duplicate:false,revision:1});
 const sold={...fixture(),id:'sold-1',observedAt:'2026-11-17T10:00:00Z',status:'sold',statusEvidence:fact('sold')};await s.ingest(sold);
 let state=await new PropertyStore(dir).read(new Date(sold.observedAt));assert.equal(state.cards[0].followed,true);assert.equal(state.cards[0].status,'sold');assert.equal(state.cards[0].available,false);assert.equal(state.cards[0].changes[0].after,'sold');
 const unknown={...fixture(),id:'unknown-1',observedAt:'2026-11-18T10:00:00Z',status:'unknown',statusEvidence:fact(null)};await s.ingest(unknown);
 state=await s.read();assert.equal(state.cards[0].status,'unknown');assert.equal(state.cards[0].followed,true);assert.equal(state.observations.length,3);
 await s.setFollowing({requestId:'follow-2',listingId:'synthetic-listing',followed:false,expectedRevision:1});state=await s.read();assert.equal(state.cards[0].followed,false);assert.equal(state.followingHistory.length,2);
});
test('following optimistic concurrency and request replay prevent lost manual choices',async()=>{
 const s=new PropertyStore(await mkdtemp(join(tmpdir(),'fh-property-concurrent-')));await s.ingest(fixture());const decision={requestId:'request-1',listingId:'synthetic-listing',followed:true,expectedRevision:0};
 await s.setFollowing(decision);assert.equal((await s.setFollowing(decision)).duplicate,true);
 await assert.rejects(s.setFollowing({...decision,followed:false}),PropertyConflict);
 await assert.rejects(s.setFollowing({...decision,requestId:'request-2',followed:false}),PropertyConflict);
 await assert.rejects(s.setFollowing({...decision,requestId:'request-3',listingId:'not-found',expectedRevision:1}));
 assert.equal((await s.read()).cards[0].followed,true);
});
test('sold cannot be inferred from missing status evidence',()=>{assert.throws(()=>validateProperty({...fixture(),status:'sold',statusEvidence:fact(null)}));});
test('late older observations do not reset current listing or follow state',async()=>{const s=new PropertyStore(await mkdtemp(join(tmpdir(),'fh-property-old-')));await s.ingest({...fixture(),id:'new',observedAt:'2026-11-18T10:00:00Z',status:'unavailable',statusEvidence:fact('unavailable')});await s.ingest(fixture());const state=await s.read();assert.equal(state.cards[0].status,'unavailable');assert.equal(state.cards[0].followed,false);});
