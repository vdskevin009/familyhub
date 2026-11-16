import test from 'node:test';
import assert from 'node:assert/strict';
import {parseVehicleSnapshot} from '../src/vehicle-api';
const at='2026-11-16T03:00:00Z';
const fact=(value:unknown)=>({value,sourceUrl:value===null?null:'https://example.com/car',checkedAt:value===null?null:at,note:'Test'});
const card={id:'observation',listingId:'listing',observedAt:at,title:'Synthetic SUV',url:'https://example.com/car',status:'active',statusEvidence:fact('active'),priceBasis:'before-tax',priceCad:fact(27000),year:fact(2021),mileageKm:fact(50000),make:fact('Test'),model:fact('SUV'),trim:fact(null),location:fact('Vancouver'),familySuv:fact(true),used:fact(true),greaterVancouver:fact(true),awd:fact(null),accidentHistory:fact(null),followed:false,changes:[]};
test('client recomputes criteria, keeps unknown accident and AWD facts',()=>{
 const result=parseVehicleSnapshot({cards:[{...card,matchPercent:100}],followingRevision:0});
 assert.equal(result.cards[0].awd.value,null);
 assert.equal(result.cards[0].accidentHistory.value,null);
 assert.equal(result.cards[0].opportunity.score,null);
});
test('client refuses duplicate listings and invalid revisions',()=>{
 assert.throws(()=>parseVehicleSnapshot({cards:[card,card],followingRevision:0}));
 assert.throws(()=>parseVehicleSnapshot({cards:[card],followingRevision:-1}));
});
test('client never converts missing price to zero',()=>{
 const result=parseVehicleSnapshot({cards:[{...card,priceCad:fact(null)}],followingRevision:0});
 assert.equal(result.cards[0].priceCad.value,null);
 assert.equal(result.cards[0].matchPercent,null);
});
