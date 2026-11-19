import test from 'node:test';
import assert from 'node:assert/strict';
import {compareProperties,parsePropertySnapshot} from '../src/property-api';
const at='2026-11-19T16:00:00Z';
const fact=(value:unknown)=>({value,sourceUrl:value===null?null:'https://example.com/fictitious',checkedAt:value===null?null:at,note:'Synthetic'});
const card=(id:string)=>({id,listingId:id,observedAt:at,address:'Fictitious '+id,url:'https://example.com/fictitious',status:'active',statusEvidence:fact('active'),priceCad:fact(1500000),bedrooms:fact(3),lowerLonsdale:fact(true),separateEntrances:fact(true),airbnb:{status:'unknown',evidence:[]},budgetHeadroomCad:200000,askingPriceReductionCad:0});
test('property comparison must contain exactly the distinct selected identities',async()=>{
  const original=globalThis.fetch;
  try {
    for(const items of [[card('x'),card('y')],[card('a'),card('a')],[card('a'),card('b'),card('c')],[null,card('b')]]) {
      globalThis.fetch=async()=>new Response(JSON.stringify({items}));
      await assert.rejects(compareProperties({Endpoint:'https://synthetic-worker.invalid',ApiKey:'synthetic-key'},['a','b']),/incohérente/);
    }
    globalThis.fetch=async()=>new Response(JSON.stringify({items:[card('b'),card('a')]}));
    const valid=await compareProperties({Endpoint:'https://synthetic-worker.invalid',ApiKey:'synthetic-key'},['a','b']);
    assert.deepEqual(new Set(valid.map(c=>c.listingId)),new Set(['a','b']));
  } finally {globalThis.fetch=original;}
});


test('browser refuses fresh availability claims backed by an old or missing status source',()=>{
 const raw={...card('a'),followed:false,changes:[],available:true,stale:false};
 const old={...raw,statusEvidence:{...fact('active'),checkedAt:'2026-10-01T16:00:00Z'}};
 const result=parsePropertySnapshot({cards:[old],followingRevision:0},new Date(at)).cards[0];
 assert.equal(result.stale,true);assert.equal(result.available,false);assert.equal(result.opportunity.score,null);
 assert.equal(result.observedAt,raw.observedAt);assert.equal(result.statusEvidence.checkedAt,'2026-10-01T16:00:00Z');
 const unknown={...raw,status:'unknown',statusEvidence:fact(null)};
 assert.equal(parsePropertySnapshot({cards:[unknown],followingRevision:0},new Date(at)).cards[0].available,false);
});

test('browser uses the exact 48-hour status boundary and refuses future evidence as available',()=>{
 const raw={...card('a'),followed:false,changes:[],statusEvidence:{...fact('active'),checkedAt:'2026-11-17T16:00:00Z'}};
 const snapshot={cards:[raw],followingRevision:0};
 assert.equal(parsePropertySnapshot(snapshot,new Date(at)).cards[0].available,true);
 assert.equal(parsePropertySnapshot(snapshot,new Date(Date.parse(at)+1)).cards[0].available,false);
 assert.equal(parsePropertySnapshot(snapshot,new Date('2026-11-18T16:00:00Z')).cards[0].available,false);
});

test('comparison applies the same browser freshness guard to existing worker results',async()=>{
 const original=globalThis.fetch;
 try {
  const items=[card('a'),card('b')].map(c=>({...c,available:true,stale:false,statusEvidence:{...fact('active'),checkedAt:'2026-10-01T16:00:00Z'}}));
  globalThis.fetch=async()=>new Response(JSON.stringify({items}));
  const result=await compareProperties({Endpoint:'https://synthetic-worker.invalid',ApiKey:'synthetic-key'},['a','b']);
  assert.ok(result.every(c=>c.stale&&!c.available&&c.opportunity.score===null));
 } finally {globalThis.fetch=original;}
});
