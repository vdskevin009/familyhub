import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyPlan, emptyEvidence } from '../apps/worker/src/grocery-planning.ts';
import { blankItem, emptyReceipt } from '../apps/worker/src/grocery-model.ts';
import { purchaseScenarioStores } from '../apps/web/src/grocery-purchase-scenarios.ts';
import { purchaseLineKey } from '../apps/worker/src/grocery-purchase-evidence.ts';
import { purchasePriceKey } from '../apps/worker/src/grocery-purchase-evidence.ts';
import { derivePurchaseScenarios, scenarioLineDiagnostics } from '../apps/worker/src/grocery-purchase-scenarios.ts';
import { emptyPurchaseResolution } from '../apps/worker/src/grocery-purchase-resolution.ts';
import { explicitScenarioFormat, wholeScenarioPacks } from '../apps/worker/src/grocery-scenario-evidence.ts';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const today='2026-11-14';
function fixture(){
 const record={id:'synthetic',revision:'r',status:'saved',extraction:'complete',reviewedAt:null,createdAt:today+'T00:00:00.000Z',duplicateOf:null,sources:[],receipt:{...emptyReceipt(),sourceType:'confirmation',store:'PC Express',date:today,currency:'CAD',total:112,items:[{...blankItem(),name:'Tofu Extra Firm',product:'Tofu Extra Firm',quantity:3,size:400,unit:'g',evidence:'Synthetic source',uncertain:true},{...blankItem(),name:'Unknown product',product:'Unknown product',quantity:1,evidence:'Synthetic source'}]}};
 const plan=emptyPlan(); plan.retailers=[{id:'wm',name:'Walmart',mode:'pickup',locality:'Fictional',areaConfirmed:true,membershipStatus:'none',otherFeesReviewed:false,delivery:null,service:null,servicePercent:null,feesTaxPercent:null,minimum:null,freeDeliveryAbove:null,evidence:emptyEvidence()}];
 plan.prices=[{id:'p',itemId:'i',retailerId:'wm',product:'Tofu Extra Firm',price:5,size:500,unit:'g',weighed:false,taxPercent:null,currency:'CAD',available:'yes',approved:false,substitution:false,kind:'public',mode:'pickup',locality:'Fictional',localityConfirmed:true,evidence:{title:'Synthetic',url:'https://example.com/tofu',date:today,until:null}}];
 return {record,plan};
}
test('partial basket normalizes quantities, rounds whole packs and never compares to the full source bill',()=>{
 const {record,plan}=fixture(),before=JSON.stringify({record,plan}); const s=purchaseScenarioStores(plan,record,today).find(s=>s.name==='Walmart');
 assert.equal(s.covered,1);assert.equal(s.count,2);assert.equal(s.missing,1);assert.equal(s.complete,false);assert.deepEqual(s.missingProducts,['Unknown product']);assert.equal(s.normalized,12);assert.equal(s.outlay,15);assert.equal(s.sourceEstimate,null);assert.deepEqual(s.observationDates,[today]);assert.match(s.lines[0].scenario.formula,/3 × 0.4 kg/);assert.equal(JSON.stringify({record,plan}),before);
});
test('same-line source subtotal is included only from source-bound evidence, never full receipt',()=>{
 const {record,plan}=fixture();plan.sourceEstimates=[{id:'e',recordId:record.id,lineIndex:0,lineKey:purchaseLineKey(record.receipt.items[0]),quantity:3,unitPrice:4,currency:'CAD',basis:'estimated-per-source-unit',sourceEvidence:'Synthetic source quote',reviewedAt:today+'T00:00:00.000Z'}];
 const s=purchaseScenarioStores(plan,record,today).find(s=>s.name==='Walmart');assert.equal(s.sourceEstimate,12); assert.notEqual(s.sourceEstimate,112);
});
test('unknown club pack cannot be replaced by one competitor pack',()=>{
 const {record,plan}=fixture();Object.assign(record.receipt.items[0],{name:'Plain Greek Yogurt 2% Club Size',product:'Plain Greek Yogurt 2% Club Size',size:null,unit:null});Object.assign(plan.prices[0],{product:'Plain Greek Yogurt 2%',size:750,unit:'g'});
 const s=purchaseScenarioStores(plan,record,today).find(s=>s.name==='Walmart');assert.equal(s.covered,0);assert.equal(s.normalized,null);
});
test('explicit yogurt fat percentage is preserved in estimated substitutions',()=>{
 const {record,plan}=fixture();Object.assign(record.receipt.items[0],{name:'Plain Greek Yogurt 2%',product:'Plain Greek Yogurt 2%'});Object.assign(plan.prices[0],{product:'Plain Greek Yogurt 0%'});
 assert.equal(purchaseScenarioStores(plan,record,today).find(s=>s.name==='Walmart').covered,0);
});
test('repeated identical references round whole packs once for combined quantity',()=>{
 const {record,plan}=fixture();record.receipt.items=[{...record.receipt.items[0],quantity:1},{...record.receipt.items[0],quantity:1}];
 const s=purchaseScenarioStores(plan,record,today).find(s=>s.name==='Walmart');assert.equal(s.normalized,8);assert.equal(s.outlay,10);assert.equal(s.complete,true);
});

test('known club format normalizes rather than assuming competitor package quantity',()=>{
 const {record,plan}=fixture();Object.assign(record.receipt.items[0],{name:'Plain Greek Yogurt 2% Club Size',product:'Plain Greek Yogurt 2% Club Size',quantity:2,size:1,unit:'kg'});Object.assign(plan.prices[0],{product:'Plain Greek Yogurt 2%',price:6,size:750,unit:'g'});
 const s=purchaseScenarioStores(plan,record,today).find(s=>s.name==='Walmart');assert.equal(s.normalized,16);assert.equal(s.outlay,18);assert.equal(s.lines[0].scenario.quantity,2);
});

function onlyLine(f){ f.record.receipt.items=[f.record.receipt.items[0]];return f; }
function secondStore(plan,overrides={}){
 plan.retailers.push({...plan.retailers[0],id:'co',name:'Costco',membershipStatus:'existing'});
 plan.prices.push({...plan.prices[0],id:'p2',retailerId:'co',size:1000,price:8,...overrides});
}
const wm=f=>purchaseScenarioStores(f.plan,f.record,today,f.state,f.records).find(s=>s.name==='Walmart');
test('an uncertain selling unit uses the same inferred physical target at every retailer',()=>{
 const f=onlyLine(fixture());Object.assign(f.record.receipt.items[0],{quantity:2,size:null,unit:null});secondStore(f.plan);
 const state=emptyPurchaseResolution();state.scenarioHints=[{id:'source',purpose:'source-format',product:'Tofu Extra Firm',productId:'',priceId:'',priceKey:'',size:1,unit:'each',packagePrice:null,sourceUrl:'https://example.com/source',observedAt:today+'T00:00:00.000Z',note:'Selling unit only'}];
 const rows=derivePurchaseScenarios([f.record],f.plan,state,today);
 assert.equal(rows.length,2);assert.deepEqual(rows.map(r=>[r.quantity,r.size,r.unit]),[[2,500,'g'],[2,500,'g']]);assert.deepEqual(rows.map(r=>r.normalized),[10,8]);
 f.plan.prices.reverse();assert.deepEqual(derivePurchaseScenarios([f.record],f.plan,state,today).map(r=>[r.size,r.unit]),[[500,'g'],[500,'g']]);
});
test('known count cannot silently turn into a Walmart mass package',()=>{
 const f=onlyLine(fixture());Object.assign(f.record.receipt.items[0],{product:'Mini Cucumbers',quantity:1,size:4,unit:'each'});Object.assign(f.plan.prices[0],{product:'Mini Cucumbers'});secondStore(f.plan);
 assert.equal(derivePurchaseScenarios([f.record],f.plan,undefined,today).length,0);
 const state=emptyPurchaseResolution();state.scenarioHints=[{id:'mass',purpose:'count-equivalent',product:'Mini Cucumbers',productId:'',priceId:'p',priceKey:purchasePriceKey(f.plan.prices[0]),size:600,unit:'g',sourceCount:4,packagePrice:null,sourceUrl:'https://example.com/mass',observedAt:today+'T00:00:00.000Z',note:'Explicit synthetic common assumption'}];
 const rows=derivePurchaseScenarios([f.record],f.plan,state,today);assert.equal(rows.length,2);assert.deepEqual(rows.map(r=>[r.size,r.unit]),[[600,'g'],[600,'g']]);
 state.scenarioHints.push({...state.scenarioHints[0],id:'conflict',size:800});assert.equal(derivePurchaseScenarios([f.record],f.plan,state,today).length,0);
});
test('g/kg and ml/l normalize; mass and volume never mix',()=>{
 for(const [source,reference,expected] of [[['kg',1.25],['g',500],12.5],[['l',1.5],['ml',500],15]]){
  const f=onlyLine(fixture());Object.assign(f.record.receipt.items[0],{quantity:1,size:source[1],unit:source[0]});Object.assign(f.plan.prices[0],{size:reference[1],unit:reference[0]});assert.equal(wm(f).normalized,expected);
 }
 const f=onlyLine(fixture());f.record.receipt.items[0].unit='l';assert.equal(wm(f).covered,0);
});
test('explicit multipack label multiplies pack contents once and retains fractional source quantity',()=>{
 const f=onlyLine(fixture());Object.assign(f.record.receipt.items[0],{product:'Tofu Extra Firm 3 × 250 g',quantity:1.5,size:null,unit:null});
 const s=wm(f);assert.equal(s.normalized,11.25);assert.equal(s.outlay,15);assert.equal(s.lines[0].scenario.size,750);
});
test('format extraction rejects nutrition, ranges, and ambiguous declarations',()=>{
 assert.deepEqual(explicitScenarioFormat('Synthetic food 2 x 400 g'),{size:800,unit:'g'});
 assert.deepEqual(explicitScenarioFormat('Synthetic food 2 lb'),{size:907.18474,unit:'g'});
 for(const title of ['Protein food 10g per serving','Synthetic 400-600 g','Synthetic 400 g / 500 g','Synthetic 6 pack'])assert.equal(explicitScenarioFormat(title),null);
});
test('positive tiny needs still require a package and exact floating point multiples stay exact',()=>{
 assert.equal(wholeScenarioPacks(1e-12),1);assert.equal(wholeScenarioPacks(3.0000000000000004),3);assert.equal(wholeScenarioPacks(3.000001),4);
});

test('nested and written multipacks use their entire quantity, never only a suffix',()=>{
 for(const [label,size] of [['2 x 3 x 100 g',600],['2 × 3 × 100 g',600],['2 packs of 500 g',1000]]){
  assert.deepEqual(explicitScenarioFormat('Tofu Extra Firm '+label),{size,unit:'g'});
  const f=onlyLine(fixture());Object.assign(f.record.receipt.items[0],{product:'Tofu Extra Firm '+label,quantity:1,size:null,unit:null});
  assert.equal(wm(f).lines[0].scenario.size,size);assert.equal(wm(f).normalized,size/500*5);
 }
 const f=onlyLine(fixture());Object.assign(f.record.receipt.items[0],{product:'Tofu Extra Firm 2 packs containing 500 g',quantity:1,size:null,unit:null});
 assert.equal(explicitScenarioFormat(f.record.receipt.items[0].product),null);assert.equal(wm(f).covered,0);
 f.record.receipt.items[0].product='Tofu Extra Firm 500 g (Pack of 2)';
 assert.equal(explicitScenarioFormat(f.record.receipt.items[0].product),null);assert.equal(wm(f).covered,0);
});

test('liquid whole eggs, whites, shell eggs and substitutes remain distinct',()=>{
 for(const source of ['Liquid Whole Eggs','Liquid Egg Whites','Large Eggs','Liquid Egg Substitute']){
  for(const reference of ['Liquid Whole Eggs','Liquid Egg Whites','Large Eggs','Liquid Egg Substitute']){
   const f=onlyLine(fixture());f.record.receipt.items[0].product=source;f.plan.prices[0].product=reference;
   assert.equal(wm(f).covered,Number(source===reference),source+' / '+reference);
  }
 }
});

function reviewedFormats(f){
 f.plan.purchaseComparisons=f.plan.prices.map((p,i)=>({id:'comparison'+i,recordId:f.record.id,lineIndex:0,lineKey:purchaseLineKey(f.record.receipt.items[0]),priceId:p.id,priceKey:purchasePriceKey(p),purpose:'comparison-only',relation:'equivalent-same-format',quantity:1,size:p.size,unit:p.unit,formatLabel:p.size+' '+p.unit,referenceFormatLabel:p.size+' '+p.unit,sourceEstimate:null,sourceEstimateEvidence:'Synthetic',provenance:'Synthetic review',reviewedAt:today+'T00:00:00.000Z'}));
}
test('reviewed equivalences cannot override the common target with each retailer pack',()=>{
 const f=onlyLine(fixture());Object.assign(f.record.receipt.items[0],{quantity:1,size:null,unit:null});secondStore(f.plan);reviewedFormats(f);
 const stores=purchaseScenarioStores(f.plan,f.record,today).filter(s=>s.covered);
 assert.deepEqual(stores.map(s=>s.normalized),[5,4]);assert.deepEqual(stores.map(s=>s.outlay),[5,8]);
 assert.deepEqual(stores.map(s=>s.lines[0].ratio*s.lines[0].price.size),[500,500]);
 assert.ok(stores.every(s=>s.estimated===1));
});
test('reviewed unknown-family equivalents with contradictory source formats abstain',()=>{
 const f=onlyLine(fixture());Object.assign(f.record.receipt.items[0],{product:'Unmapped source',quantity:1,size:null,unit:null});secondStore(f.plan);reviewedFormats(f);
 assert.ok(purchaseScenarioStores(f.plan,f.record,today).every(s=>s.covered===0));
 f.plan.prices[1].size=500;reviewedFormats(f);
 assert.equal(purchaseScenarioStores(f.plan,f.record,today).filter(s=>s.covered).length,2);
});

test('reviewed unknown-family equivalents cannot contradict an explicit source label',()=>{
 const f=onlyLine(fixture());Object.assign(f.record.receipt.items[0],{product:'Brand Alpha Quinoa 500 g',quantity:1,size:null,unit:null});
 Object.assign(f.plan.prices[0],{product:'Brand Beta Quinoa',size:1000});secondStore(f.plan);reviewedFormats(f);
 assert.ok(purchaseScenarioStores(f.plan,f.record,today).every(s=>s.covered===0));
});

test('stale reviewed formats do not determine the source target of a new scenario',()=>{
 const f=onlyLine(fixture());Object.assign(f.record.receipt.items[0],{quantity:1,size:null,unit:null});reviewedFormats(f);
 Object.assign(f.plan.purchaseComparisons[0],{priceId:'removed-price',size:2000});
 assert.equal(wm(f).lines[0].scenario.size,500);assert.equal(wm(f).normalized,5);
});

test('a reviewed unknown selling unit cannot re-enter physical package inference',()=>{
 const f=onlyLine(fixture());Object.assign(f.record.receipt.items[0],{quantity:1,size:null,unit:null});Object.assign(f.plan.prices[0],{size:1,unit:'each'});reviewedFormats(f);
 secondStore(f.plan,{size:500,unit:'g'});
 const row=derivePurchaseScenarios([f.record],f.plan,undefined,today).find(r=>r.priceId==='p2');
 assert.equal(row.size,500);assert.equal(row.unit,'g');assert.equal(row.normalized,8);
});
test('an unrecognized product with exact source text can use an independent price',()=>{
 const f=onlyLine(fixture());f.record.receipt.items[0].product='Synthetic pantry item';f.plan.prices[0].product='Synthetic pantry item';assert.equal(wm(f).covered,1);assert.equal(wm(f).lines[0].scenario.family,'exact-name');
 f.plan.prices[0].product='Other synthetic pantry item';assert.equal(wm(f).covered,0);assert.deepEqual(wm(f).lines[0].diagnostic.reasons,['family-unrecognized']);
});
test('bounded new families preserve cheese type, salted butter and dry lasagne distinctions',()=>{
 for(const [source,ref,covered] of [['Medium Cheddar Cheese Slices','Example Medium Cheddar Cheese Slices',1],['Medium Cheddar Cheese Slices','Example Marble Cheddar Cheese Slices',0],['Salted Butter','Example Salted Butter',1],['Salted Butter','Example Unsalted Butter',0],['Salted Butter','Example Salted Butter with Canola Oil',0],['Lasagne Pasta','Example Classic Lasagne Pasta',1],['Lasagne Pasta','Example Oven-Ready Lasagne Pasta',0]]){
  const f=onlyLine(fixture());f.record.receipt.items[0].product=source;f.plan.prices[0].product=ref;assert.equal(wm(f).covered,covered,source+' / '+ref);
 }
});
test('dietary and preservation constraints survive estimated alternatives',()=>{
 for(const [source,ref] of [['Organic Tofu Extra Firm','Tofu Extra Firm'],['Gluten Free Spaghetti','Spaghetti'],['Frozen Strawberries','Fresh Strawberries'],['Smoked Salmon','Salmon'],['Plain Greek 2%','Plain Greek 0%'],['Plant Based Plain Greek 2%','Plain Greek 2%']]){
  const f=onlyLine(fixture());f.record.receipt.items[0].product=source;f.plan.prices[0].product=ref;assert.equal(wm(f).covered,0,source);
 }
});
test('missing price does not become zero; an evidenced zero remains zero',()=>{
 for(const value of [null,undefined,NaN,Infinity,-1]){const f=onlyLine(fixture());f.plan.prices[0].price=value;assert.equal(wm(f).normalized,null);assert.deepEqual(wm(f).lines[0].diagnostic.reasons,['missing-price']);}
 const f=onlyLine(fixture());f.plan.prices[0].price=0;assert.equal(wm(f).normalized,0);assert.equal(wm(f).covered,1);
});
test('search and category pages stay leads even when a stored price is present',()=>{
 for(const url of ['https://example.com/results?q=tofu','https://example.com/categories/food','https://example.com/store/s?k=tofu']){
  const f=onlyLine(fixture());f.plan.prices[0].evidence.url=url;assert.equal(wm(f).covered,0);assert.deepEqual(wm(f).lines[0].diagnostic.reasons,['source-unverified']);
 }
});
test('invalid and old dates block; recent expired price stays explicitly historical',()=>{
 for(const [date,reason] of [['','invalid-date'],['2026-02-30','invalid-date'],['2027-01-01','invalid-date'],['2026-01-01','stale-price']]){
  const f=onlyLine(fixture());f.plan.prices[0].evidence.date=date;assert.equal(wm(f).covered,0);assert.deepEqual(wm(f).lines[0].diagnostic.reasons,[reason]);
 }
 const f=onlyLine(fixture());Object.assign(f.plan.prices[0].evidence,{date:'2026-11-10',until:'2026-11-12'});assert.equal(wm(f).covered,1);assert.equal(wm(f).historical,true);assert.equal(wm(f).limited,true);
});
test('nonlocal and unavailable references never become verified current offers',()=>{
 const f=onlyLine(fixture());Object.assign(f.plan.prices[0],{localityConfirmed:false,available:'no',mode:'unknown'});const s=wm(f);assert.equal(s.estimated,1);assert.equal(s.verified,0);assert.equal(s.nonlocal,true);assert.equal(s.limited,true);assert.match(s.lines[0].scenario.limits.join(' '),/Purchase channel unknown or different/);assert.match(s.lines[0].scenario.limits.join(' '),/Unavailable according to the source/);
});
test('separate localities cannot manufacture a complete basket',()=>{
 const f=fixture();f.record.receipt.items[1]={...f.record.receipt.items[0],product:'Plain Greek 2%'};
 f.plan.prices.push({...f.plan.prices[0],id:'other',product:'Plain Greek 2%',locality:'Another branch'});
 const s=wm(f);assert.equal(s.covered,1);assert.equal(s.complete,false);assert.equal(s.multiContext,false);assert.match(s.lines.find(l=>l.normalized===null).reason,/different location or purchase channel/);
 assert.equal(derivePurchaseScenarios([f.record],f.plan,undefined,today).length,1);
});
test('a coherent context covering more rows wins over isolated newer prices',()=>{
 const f=fixture();f.record.receipt.items[1]={...f.record.receipt.items[0],product:'Plain Greek 2%'};
 f.plan.prices.push({...f.plan.prices[0],id:'y',product:'Plain Greek 2%'},{...f.plan.prices[0],id:'new',locality:'Another branch',evidence:{...f.plan.prices[0].evidence,date:today}});
 const s=wm(f);assert.equal(s.covered,2);assert.equal(s.complete,true);assert.deepEqual(s.lines.map(l=>l.price.locality),['Fictional','Fictional']);
});
test('receipt reference must be final, independent, exact-id bound, and unambiguous',()=>{
 const f=onlyLine(fixture());const other=structuredClone(f.record);other.id='other';other.receipt.sourceType='final-receipt';other.reviewedAt=today;Object.assign(other.receipt.items[0],{amount:10,quantity:2,size:500});
 Object.assign(f.plan.prices[0],{kind:'receipt',price:10,evidence:{title:'Receipt other',url:'',date:today,until:null}});f.records=[f.record,other];
 assert.equal(wm(f).normalized,12); // 3 * 400 g / 500 g * (10 / 2)
 other.duplicateOf=f.record.id;assert.equal(wm(f).covered,0);other.duplicateOf=null;
 other.receipt.sourceType='confirmation';assert.equal(wm(f).covered,0);other.receipt.sourceType='final-receipt';
 f.plan.prices[0].evidence.title='Receipt other-extra';assert.equal(wm(f).covered,0);f.plan.prices[0].evidence.title='Receipt other';
 other.receipt.items.push({...other.receipt.items[0]});assert.equal(wm(f).covered,0);
});
test('future hints and product-id-specific hints never leak into another purchase',()=>{
 const f=onlyLine(fixture());Object.assign(f.record.receipt.items[0],{size:null,unit:null});const state=emptyPurchaseResolution();
 const hint={id:'h',purpose:'source-format',product:'Tofu Extra Firm',productId:'',priceId:'',priceKey:'',size:999,unit:'g',packagePrice:null,sourceUrl:'https://example.com/tofu',observedAt:'2030-01-01T00:00:00.000Z',note:'Future'};
 state.scenarioHints=[hint];assert.equal(derivePurchaseScenarios([f.record],f.plan,state,today)[0].size,500);
 hint.observedAt=today+'T00:00:00.000Z';hint.productId='other-sku';assert.equal(derivePurchaseScenarios([f.record],f.plan,state,today)[0].size,500);
});
test('duplicate purchases never receive calculated coverage',()=>{
 const f=onlyLine(fixture());f.record.duplicateOf='original';assert.equal(wm(f).covered,0);assert.equal(wm(f).complete,false);
});
test('a source-bound format hint resolves an unknown reference without being discarded by its old note',()=>{
 const f=onlyLine(fixture());Object.assign(f.plan.prices[0],{size:1,unit:'each',matchNote:'Format non confirmé'});const state=emptyPurchaseResolution();
 const h={id:'format',purpose:'reference-format',product:f.plan.prices[0].product,productId:'',priceId:'p',priceKey:purchasePriceKey(f.plan.prices[0]),size:500,unit:'g',packagePrice:null,sourceUrl:'https://example.com/format',observedAt:today+'T00:00:00.000Z',note:'Independent matching format source'};
 state.scenarioHints=[h];f.state=state;assert.equal(wm(f).normalized,12);assert.equal(wm(f).outlay,15);assert.equal(wm(f).packEstimated,true);
 state.scenarioHints.push({...h,id:'contradiction',size:1000});assert.equal(wm(f).covered,0);
});
test('conflicting common source hypotheses remain unresolved',()=>{
 const f=onlyLine(fixture());Object.assign(f.record.receipt.items[0],{size:null,unit:null});const state=emptyPurchaseResolution();
 const h={id:'format',purpose:'source-format',product:'Tofu Extra Firm',productId:'',priceId:'',priceKey:'',size:500,unit:'g',packagePrice:null,sourceUrl:'https://example.com/format',observedAt:today+'T00:00:00.000Z',note:'Synthetic assumption'};
 state.scenarioHints=[h,{...h,id:'conflict',size:1000}];f.state=state;assert.equal(wm(f).covered,0);
});
test('the coverage CLI replays synthetic files and public overlays without changing source bytes',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'grocery-coverage-'));try{
  const f=onlyLine(fixture()),state=emptyPurchaseResolution(),originals={purchases:JSON.stringify({records:[f.record]}),planning:JSON.stringify(f.plan),'purchase-resolution':JSON.stringify(state)};
  for(const [name,bytes]of Object.entries(originals))await writeFile(join(dir,name+'.json'),bytes);
  const run=(...args)=>promisify(execFile)(process.execPath,[...process.execArgv,'scripts/grocery-coverage-report.mjs',dir,today,...args],{maxBuffer:1000000});
  const report=JSON.parse((await run()).stdout);assert.equal(report.purchases[0].stores[0].covered,1);assert.equal(report.referenceOverlay,false);assert.ok(!JSON.stringify(report).includes('Tofu'));
  const overlay=emptyPlan();overlay.items=[{id:'extra-item',name:'Synthetic unmatched item',quantity:null,size:null,unit:null,preference:'',substitutions:false,active:false,origin:'synthetic'}];overlay.retailers=[{...f.plan.retailers[0],id:'extra-store',membershipStatus:'unknown'}];overlay.prices=[{...f.plan.prices[0],id:'extra-price',itemId:'extra-item',retailerId:'extra-store'}];
  const file=join(dir,'overlay.json');await writeFile(file,JSON.stringify(overlay));assert.equal(JSON.parse((await run(file)).stdout).referenceOverlay,true);
  overlay.prices[0].kind='receipt';await writeFile(file,JSON.stringify(overlay));await assert.rejects(run(file),/Only public product references/);
  for(const [name,bytes]of Object.entries(originals))assert.equal(await readFile(join(dir,name+'.json'),'utf8'),bytes);
 }finally{await rm(dir,{recursive:true,force:true});}
});
