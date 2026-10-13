import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { emptyPlan, type GroceryPlan, type GroceryPrice, type ShoppingItem } from "../../worker/src/grocery-planning";
import { observedTargetOpportunities, targetProductConflict } from "../src/grocery-target-observations";
import GroceryTargetView from "../src/views/GroceryTargetView";
const today=new Date().toISOString().slice(0,10);
function fixture():GroceryPlan {
  const evidence={title:"Synthetic observed source",url:"https://example.com/synthetic",date:today,until:null};
  const item:ShoppingItem={id:"coffee",name:"Synthetic whole bean coffee",quantity:null,size:null,unit:"kg",preference:"",substitutions:false,active:false,origin:"synthetic",cadence:"unknown"};
  const plan=emptyPlan();plan.area="Synthetic city";plan.areaConfirmed=true;plan.items=[item];
  plan.retailers=["Superstore","Costco","Walmart"].map((name,n)=>({id:"r"+n,name,delivery:null,service:null,servicePercent:null,feesTaxPercent:null,minimum:null,freeDeliveryAbove:null,areaConfirmed:false,otherFeesReviewed:false,mode:n===1?"delivery":"pickup",locality:"Synthetic city",evidence}));
  plan.prices=plan.retailers.map((r,n):GroceryPrice=>({id:"p"+n,itemId:item.id,retailerId:r.id,product:"Synthetic whole bean coffee",price:n===0?10:n===1?8:12,size:n===0?500:1,unit:n===0?"g":"kg",weighed:false,taxPercent:null,currency:"CAD",available:"unknown",approved:false,substitution:true,kind:"public",evidence,mode:r.mode,locality:r.locality,localityConfirmed:false,matchNote:"Synthetic association, quality not reviewed"}));
  return plan;
}
test("Unreviewed sourced opportunities appear by store versus Superstore without approving anything or asserting stock/fees",()=>{
  const plan=fixture(),before=structuredClone(plan),result=observedTargetOpportunities(plan,plan.items);
  assert.equal(result.validatedCount,0);assert.equal(result.observedCount,2);assert.equal(result.result.find(r=>r.alternative.r.name==="Costco")!.percent,60);
  assert.ok(result.result.every(r=>!r.validated));for(const row of result.result)for(const warning of ["Sources non revues","Substitution non autorisée","Disponibilité à vérifier","Zone à vérifier","Frais / taxes à vérifier"])assert.ok(row.warnings.includes(warning));
  assert.ok(result.result.find(r=>r.alternative.r.name==="Costco")!.warnings.includes("Modes différents"));assert.deepEqual(plan,before);
  const html=renderToStaticMarkup(createElement(GroceryTargetView,{plan,items:plan.items,ready:true}));
  for(const text of ["Costco","À vérifier","Références validées seulement","Écart unitaire observé","équivalence à confirmer","Modes différents","Substitution non autorisée","Disponibilité à vérifier","Frais / taxes à vérifier","Référence Superstore à vérifier"])assert.ok(html.includes(text),text);
  assert.ok(!html.includes("Le moins cher"));assert.ok(!html.includes("<details open"));assert.deepEqual(plan,before);
});
test("Observed percentage uses the same dimension/currency, with g/kg and ml/l conversion",()=>{
  const plan=fixture();assert.equal(observedTargetOpportunities(plan,plan.items).result[0].baseline.rate!.amount,20);
  plan.items[0].name="Synthetic almond milk";plan.items[0].unit="l";plan.prices.forEach(p=>p.product="Synthetic almond milk");plan.prices[0].unit="ml";plan.prices[0].size=500;plan.prices[1].unit="l";plan.prices[2].unit="l";
  assert.equal(observedTargetOpportunities(plan,plan.items).result.find(r=>r.alternative.r.name==="Costco")!.percent,60);
  plan.prices[1].unit="kg";assert.equal(observedTargetOpportunities(plan,plan.items).result.filter(r=>r.alternative.r.name==="Costco").length,0);
});
test("Known incompatible coffee/milk/yogurt/fresh-frozen types cannot receive any percentage, even with reviewed flags",()=>{
  for(const [need,base,alt] of [["Synthetic coffee","Whole bean coffee","Instant coffee"],["Synthetic coffee","Whole bean coffee","Ground coffee"],["Synthetic capsules coffee","Nespresso Original capsules coffee","Keurig K-cup coffee"],["Synthetic milk","Cow milk","Almond milk"],["Synthetic yogurt","Greek yogurt","Skyr yogurt"],["Synthetic vegetables","Fresh broccoli","Frozen broccoli"]]){
    const plan=fixture();plan.items[0].name=need;plan.items[0].substitutions=true;plan.prices[0].product=base;plan.prices[1].product=alt;plan.prices=plan.prices.slice(0,2);plan.prices.forEach(p=>{p.approved=true;p.available="yes";p.localityConfirmed=true;p.matchNote="Synthetic review"});plan.retailers.forEach(r=>r.areaConfirmed=true);
    assert.ok(targetProductConflict(plan.items[0],plan.prices[0],plan.prices[1]));assert.equal(observedTargetOpportunities(plan,plan.items).result.length,0);
  }
});
test("Missing/zero/expired/old/receipt references, unavailable offers, unknown modes and uncertain formats never create an observed winner",()=>{
  for(const patch of [{price:0},{currency:"USD"},{kind:"receipt"},{mode:"unknown"},{evidence:{...fixture().prices[0].evidence,date:"2000-01-01"}},{evidence:{...fixture().prices[0].evidence,until:"2000-01-01"}},{matchNote:"Format non confirmé"}] as Partial<GroceryPrice>[]){
    const plan=fixture();plan.prices[0]={...plan.prices[0],...patch};const result=observedTargetOpportunities(plan,plan.items);assert.equal(result.result.length,0);assert.ok(result.excluded.length);
  }
  for(const patch of [{available:"no"},{currency:"USD"},{mode:"unknown"},{matchNote:"Prix de barquette estimé"}] as Partial<GroceryPrice>[]){const plan=fixture();plan.prices=plan.prices.slice(0,2);plan.prices[1]={...plan.prices[1],...patch};assert.equal(observedTargetOpportunities(plan,plan.items).result.length,0);}
  const plan=fixture();plan.prices=plan.prices.filter(p=>p.retailerId!=="r0");assert.match(observedTargetOpportunities(plan,plan.items).excluded[0].reasons.join(),/Superstore/);
});
test("Validated references stay distinct and require their original evidence flags, equivalence and matching mode",()=>{
  const plan=fixture();plan.items[0].substitutions=true;plan.retailers.forEach(r=>{r.areaConfirmed=true;r.mode="pickup"});plan.prices.forEach(p=>{p.approved=true;p.available="yes";p.localityConfirmed=true;p.mode="pickup";p.substitution=false});
  const result=observedTargetOpportunities(plan,plan.items);assert.equal(result.validatedCount,2);assert.equal(result.observedCount,0);
  plan.prices[1].approved=false;const mixed=observedTargetOpportunities(plan,plan.items);assert.equal(mixed.validatedCount,1);assert.equal(mixed.observedCount,1);
});
test("Lowest matching-mode baseline is conservative; a tiny positive gap cannot round to zero",()=>{
  const plan=fixture();plan.prices.push({...plan.prices[0],id:"lower-reference",price:8,size:500});
  const costco=observedTargetOpportunities(plan,plan.items).result.find(r=>r.alternative.r.name==="Costco")!;assert.equal(costco.baseline.p.id,"lower-reference");assert.equal(costco.percent,50);
  plan.prices[1].price=15.999;assert.ok(observedTargetOpportunities(plan,plan.items).result.find(r=>r.alternative.r.name==="Costco")!.percent>0);
});
