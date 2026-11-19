import test from 'node:test';
import assert from 'node:assert/strict';
import {compareProperties} from '../src/property-api';
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
