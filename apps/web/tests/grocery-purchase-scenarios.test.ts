import test from "node:test";
import assert from "node:assert/strict";
import { blankItem, emptyReceipt, type GroceryRecord } from "../../worker/src/grocery-model";
import { emptyPlan, type GroceryPlan, type GroceryPrice } from "../../worker/src/grocery-planning";
import { emptyPurchaseResolution, type PurchaseResolution } from "../../worker/src/grocery-purchase-resolution";
import { purchaseLineKey, purchasePriceKey } from "../../worker/src/grocery-purchase-evidence";
import { derivePurchaseScenarios } from "../../worker/src/grocery-purchase-scenarios";
import { purchaseScenarioStores } from "../src/grocery-purchase-scenarios";
import { purchaseStoreComparisons } from "../src/grocery-purchases";
const today="2026-10-29";
const record=(product:string,extra={})=>({id:"fictional-purchase",revision:"r",status:"saved",extraction:"complete",reviewedAt:null,createdAt:"2026-10-28T12:00:00.000Z",duplicateOf:null,sources:[],receipt:{...emptyReceipt(),sourceType:"confirmation",store:"PC Express fictional",date:today,currency:"CAD",items:[{...blankItem(),name:product,product,quantity:1,evidence:"Fictional source",...extra}]}} as GroceryRecord);
function planFor(product:string,size=400,unit:"g"|"kg"|"l"|"each"="g",price=4):GroceryPlan{return{...emptyPlan(),items:[{id:"item",name:product,quantity:null,size:null,unit:null,preference:"",substitutions:false,active:false,origin:"fictional"}],retailers:[{id:"wm",name:"Walmart",mode:"pickup",locality:"Fictional branch",areaConfirmed:true,enabled:true,membershipStatus:"none",membershipWeekly:0,delivery:null,service:null,servicePercent:null,feesTaxPercent:null,minimum:null,freeDeliveryAbove:null,otherFeesReviewed:false,evidence:{title:"Fictional source",url:"https://example.com/branch",date:today,until:null}}],prices:[{id:"price",itemId:"item",retailerId:"wm",product,price,size,unit,weighed:false,taxPercent:null,currency:"CAD",available:"yes",substitution:false,approved:true,kind:"public",mode:"pickup",locality:"Fictional branch",localityConfirmed:true,matchNote:"Fictional exact product reviewed",evidence:{title:"Fictional source",url:"https://example.com/price",date:today,until:null}}]};}
test("verified comparison remains separate; prorata and whole packages are different",()=>{
 const r=record("Fictional Free Range Eggs",{quantity:1,size:12,unit:"each",uncertain:false}),p=planFor(r.receipt.items[0].product,15,"each",6),before=JSON.stringify({r,p});
 const s=purchaseScenarioStores(p,r,today)[0];assert.equal(s.verified,1);assert.equal(s.estimated,0);assert.equal(s.normalized,4.8);assert.equal(s.outlay,6);assert.equal(JSON.stringify({r,p}),before);
});
test("unknown quantity and format use an explicit one-pack hypothesis without rewriting the confirmation",()=>{
 const r=record("Fictional Tofu Extra Firm",{quantity:null}),p=planFor("Other Tofu Extra Firm",350,"g",3.5),before=JSON.stringify({r,p});p.prices[0].substitution=true;p.prices[0].approved=false;
 const s=purchaseScenarioStores(p,r,today)[0];assert.equal(s.verified,0);assert.equal(s.estimated,1);assert.equal(s.normalized,3.5);assert.match(s.lines[0].scenario!.assumptions.join(" "),/Quantité achetée inconnue/);assert.equal(s.lines[0].scenario!.relation,"estimated-substitution");
 assert.equal(r.receipt.sourceType,"confirmation");assert.equal(r.receipt.items[0].quantity,null);assert.equal(purchaseStoreComparisons(p,r,today)[0].covered,0);assert.ok(before.length);
});
test("missing independent price stays unavailable and a receipt never compares against itself",()=>{
 const r=record("Fictional Tofu Extra Firm",{size:350,unit:"g",amount:3.5}),p=planFor(r.receipt.items[0].product,350,"g",3.5);p.prices[0].kind="receipt";p.prices[0].evidence.url="";p.prices[0].evidence.title="Fictional ticket "+r.id;
 const s=purchaseScenarioStores(p,r,today)[0];assert.equal(s.covered,0);assert.equal(s.normalized,null);assert.match(s.lines[0].reason,/aucune référence indépendante/);
});
test("old and nonlocal prices are estimates with age and conditions, never verified or alert inputs",()=>{
 const r=record("Fictional Tofu Extra Firm",{size:350,unit:"g"}),p=planFor(r.receipt.items[0].product,350,"g",3.5);p.prices[0].evidence.date="2026-10-12";p.prices[0].localityConfirmed=false;p.prices[0].available="unknown";
 const s=purchaseScenarioStores(p,r,today)[0];assert.equal(s.estimated,1);assert.equal(s.verified,0);assert.equal(s.lines[0].scenario!.ageDays,17);assert.match(s.lines[0].scenario!.limits.join(" "),/historique.*non locale.*Disponibilité/s);assert.equal(purchaseStoreComparisons(p,r,today)[0].covered,0);
});
test("dietary constraints and kg/L conflicts are unavailable rather than guessed conversions",()=>{
 const organic=record("Organic Tofu Extra Firm"),p=planFor("Conventional Tofu Extra Firm");assert.equal(purchaseScenarioStores(p,organic,today)[0].covered,0);
 const almond=record("Original Unsweetened Almond Milk",{size:1,unit:"kg"}),a=planFor(almond.receipt.items[0].product,1,"l",4);const s=purchaseScenarioStores(a,almond,today)[0];assert.equal(s.covered,0);assert.match(s.lines[0].reason,/unité comparable/);
});
test("count-to-weight mini-cucumber scenario spells out its package assumption",()=>{
 const r=record("Mini Cucumbers",{size:6,unit:"each"}),p=planFor("Other Mini Cucumbers",453.59237,"g",3);const s=purchaseScenarioStores(p,r,today)[0];assert.equal(s.estimated,1);assert.equal(s.normalized,3);assert.match(s.lines[0].scenario!.assumptions.join(" "),/75.6 g par mini/);assert.match(s.lines[0].scenario!.formula,/0.453592 kg/);
});
test("household 700g stays scoped to its reference; older alternative SKU stays 1.41kg, all estimated",()=>{
 const name="Boneless Skinless Chicken Breasts",current=record(name),old={...record(name),id:"older"},future={...record(name,{productReference:{provider:"pcexpress",id:"22222222_EA"}}),id:"future"},p=planFor(name,1,"kg",10),state=emptyPurchaseResolution();p.prices[0].weighed=true;
 state.candidates=[{id:"household",recordId:current.id,lineIndex:0,lineKey:purchaseLineKey(current.receipt.items[0]),product:name,brand:"Fictional",productId:"22222222_EA",itemId:"item",size:700,unit:"g",formatLabel:"700g household assumption",formatBasis:"household-assumption",sourceUrl:"https://example.com/format",observedAt:"2026-10-28T00:00:00.000Z",note:"Fictional user hypothesis for this SKU only"}];
 state.scenarioHints=[{id:"old-format",purpose:"source-format",product:name,productId:"11111111_EA",priceId:"",priceKey:"",size:1.41,unit:"kg",packagePrice:null,sourceUrl:"https://example.com/other-format",observedAt:"2026-10-28T00:00:00.000Z",note:"Different SKU, old identity remains estimated"}];
 const rows=derivePurchaseScenarios([current,old,future],p,state,today);assert.ok(Math.abs(rows.find(s=>s.recordId===current.id)!.normalized-7)<1e-10);assert.equal(rows.find(s=>s.recordId===old.id)!.normalized,14.1);assert.ok(Math.abs(rows.find(s=>s.recordId===future.id)!.normalized-7)<1e-10);assert.equal(old.receipt.items[0].size,null);
});
test("withdrawal survives new prices and repeated evidence; no estimated resurrection",()=>{
 const r=record("Tofu Extra Firm"),p=planFor(r.receipt.items[0].product),state=emptyPurchaseResolution();state.candidates=[{id:"withdrawn",recordId:r.id,lineIndex:0,lineKey:purchaseLineKey(r.receipt.items[0]),product:r.receipt.items[0].product,brand:"",productId:"11111111_EA",itemId:"item",size:400,unit:"g",formatLabel:"400g",formatBasis:"public-source",sourceUrl:"https://example.com/format",observedAt:"2026-10-28T00:00:00.000Z",note:"Fictional"}];state.decisions.withdrawn={state:"unconfirmed",at:"2026-10-28T00:00:00.000Z"};
 assert.equal(purchaseScenarioStores(p,r,today,state)[0].covered,0);p.prices[0].price=2;assert.equal(purchaseScenarioStores(p,r,today,state)[0].covered,0);
});
test("repeated fractional rows share a whole package and bound reference-pack hints become stale after price edits",()=>{
 const r=record("Fictional Free Range Eggs",{quantity:1,size:6,unit:"each",uncertain:true}),p=planFor(r.receipt.items[0].product,15,"each",6);r.receipt.items.push({...r.receipt.items[0]});const s=purchaseScenarioStores(p,r,today)[0];assert.equal(s.estimated,2);assert.equal(s.normalized,4.8);assert.equal(s.outlay,6);
 const chicken=record("Boneless Skinless Chicken Breasts",{size:.7,unit:"kg"}),c=planFor(chicken.receipt.items[0].product,1,"kg",10),state=emptyPurchaseResolution();c.prices[0].weighed=true;state.scenarioHints=[{id:"pack",purpose:"reference-pack",product:c.prices[0].product,productId:"",priceId:"price",priceKey:purchasePriceKey(c.prices[0]),size:.8,unit:"kg",packagePrice:8,sourceUrl:"https://example.com/price",observedAt:"2026-10-28T00:00:00.000Z",note:"Fictional average pack"}];
 assert.equal(purchaseScenarioStores(c,chicken,today,state)[0].outlay,8);c.prices[0].price=12;assert.equal(purchaseScenarioStores(c,chicken,today,state)[0].outlay,null);
});
