import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyPlan, emptyEvidence } from '../apps/worker/src/grocery-planning.ts';
import { blankItem, emptyReceipt } from '../apps/worker/src/grocery-model.ts';
import { purchaseScenarioStores } from '../apps/web/src/grocery-purchase-scenarios.ts';
import { purchaseLineKey } from '../apps/worker/src/grocery-purchase-evidence.ts';
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
