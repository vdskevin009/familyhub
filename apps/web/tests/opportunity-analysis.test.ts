import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSales, projectDecision, vehicleAsks, localDay, newSale } from '../src/opportunity-analysis';
import type { PropertyCard } from '../src/property-api';
import type { VehicleCard } from '../src/vehicle-api';

const at=Date.parse('2026-11-27T20:00:00Z');
const date=(n:number)=>new Date(at+n).toISOString();
const fact=<T>(value:T,t=at)=>({value,checkedAt:new Date(t).toISOString(),sourceUrl:'https://listing.invalid/a',note:''});
const property={address:'Lot A',listingId:'A',url:'https://listing.invalid/a',observedAt:date(0),status:'active',statusEvidence:fact('active'),priceCad:fact(530000),criteria:[{id:'budget',pass:true}]} as PropertyCard;
const rows=[500000,530000,550000].map((value,i)=>({...newSale(),address:'Distinct '+i,kind:'sold' as const,amount:String(value),area:'1000',source:'https://sales.invalid/'+i,eventDate:'2026-11-01',checkedDate:'2026-11-25',rationale:'Appartement similaire, même état.',comparable:true}));
const evaluate=(rs=rows,subject=property,t=at)=>evaluateSales(subject,rs,t,'1000','https://subject.invalid/area');

test('dated concluded sales place the ask relative to the actual interval',()=>{
  const result=evaluate();assert.deepEqual(result.range,{low:500000,high:550000});
  assert.match(result.verdict,/within the selected sales range/);
  assert.match(evaluate(rows,{...property,priceCad:fact(450000)}).verdict,/below the selected sales/);
  assert.match(evaluate(rows,{...property,priceCad:fact(560000)}).verdict,/above the selected sales/);
  assert.equal(localDay(Date.parse('2026-11-27T02:00:00Z')),'2026-11-26');
});
test('listed, duplicate, subject, stale, future, noncomparable and dispersed references cannot establish a price',()=>{
  for(const patch of [{kind:'asking'},{address:property.address},{source:rows[1].source+'?utm_source=test'},{checkedDate:'2026-11-28'},{eventDate:'2026-04-01'},{checkedDate:'2026-10-01'},{eventDate:'2026-02-30'},{area:'1100.1'},{comparable:false},{rationale:''},{source:'file:///x'},{amount:'700000'},{amount:'0'}]){
    const changed=rows.map((row,i)=>i===0?{...row,...patch}:row);
    assert.equal(evaluateSales(property,changed as typeof rows,at,'1000','https://source.invalid/area').range,null,JSON.stringify(patch));
  }
  assert.equal(evaluate(rows.slice(0,2)).range,null);
  assert.equal(evaluateSales(property,rows,at,'1000','').range,null);
});
test('48-hour ask window, 180-day sale window, 10% size and 20% spread have inclusive boundaries',()=>{
  const changes=rows.map((r,i)=>i===0?{...r,eventDate:'2026-05-31',area:'1100'}:{...r,amount:'600000'});
  assert.ok(evaluate(changes,{...property,priceCad:fact(530000,at-48*3600000)}).range);
  assert.equal(evaluate(changes.map(r=>({...r,eventDate:'2026-05-30'}))).range,null);
  for(const delta of [-48*3600000-1,1]){
    const s={...property,priceCad:fact(530000,at+delta)};
    assert.match(projectDecision(s,at),/Recheck/);assert.equal(evaluate(rows,s).range,null);
  }
  for(const status of ['sold','withdrawn','unknown'] as const) assert.equal(evaluate(rows,{...property,status}).range,null);
});
test('vehicle asking references require distinct current used local examples with matching configuration and kilometres',()=>{
  const car={...property,make:fact('Make'),model:fact('Model'),year:fact(2022),trim:fact('EX'),awd:fact(false),greaterVancouver:fact(true),used:fact(true),mileageKm:fact(60000)} as unknown as VehicleCard;
  const peer={...car,url:'https://listing.invalid/b',listingId:'B',mileageKm:fact(70000)};
  assert.equal(vehicleAsks(car,[car,peer],at).length,1);
  for(const patch of [{trim:fact(null)},{used:fact(false)},{awd:fact(true)},{greaterVancouver:fact(false)},{mileageKm:fact(70001)},{priceCad:fact(1000,at-48*3600000-1)},{url:car.url+'#copy'}]){
    assert.equal(vehicleAsks(car,[{...peer,...patch} as VehicleCard],at).length,0);
  }
  assert.equal(vehicleAsks(car,[peer,{...peer,listingId:'copy'}],at).length,0);
});
