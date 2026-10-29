import test from "node:test";
import assert from "node:assert/strict";
import { blankItem, emptyReceipt, type GroceryRecord } from "../../worker/src/grocery-model";
import { emptyPlan, type GroceryPlan, type GroceryPrice } from "../../worker/src/grocery-planning";
import { emptyPurchaseResolution, type PurchaseResolution } from "../../worker/src/grocery-purchase-resolution";
import { purchaseLineKey, purchasePriceKey } from "../../worker/src/grocery-purchase-evidence";
import { derivePurchaseScenarios } from "../../worker/src/grocery-purchase-scenarios";
import { purchaseScenarioStores } from "../src/grocery-purchase-scenarios";
import { purchaseStoreComparisons } from "../src/grocery-purchases";
import { purchaseRetailerName } from "../../worker/src/grocery-purchase-retailers";
import { validateReferenceLeads } from "../../worker/src/grocery-purchase-scenario-model";
const today="2026-10-29";
const record=(product:string,extra={})=>({id:"fictional-purchase",revision:"r",status:"saved",extraction:"complete",reviewedAt:null,createdAt:"2026-10-28T12:00:00.000Z",duplicateOf:null,sources:[],receipt:{...emptyReceipt(),sourceType:"confirmation",store:"PC Express fictional",date:today,currency:"CAD",items:[{...blankItem(),name:product,product,quantity:1,evidence:"Fictional source",...extra}]}} as GroceryRecord);
function planFor(product:string,size=400,unit:"g"|"kg"|"l"|"each"="g",price=4):GroceryPlan{return{...emptyPlan(),items:[{id:"item",name:product,quantity:null,size:null,unit:null,preference:"",substitutions:false,active:false,origin:"fictional"}],retailers:[{id:"wm",name:"Walmart",mode:"pickup",locality:"Fictional branch",areaConfirmed:true,enabled:true,membershipStatus:"none",membershipWeekly:0,delivery:null,service:null,servicePercent:null,feesTaxPercent:null,minimum:null,freeDeliveryAbove:null,otherFeesReviewed:false,evidence:{title:"Fictional source",url:"https://example.com/branch",date:today,until:null}}],prices:[{id:"price",itemId:"item",retailerId:"wm",product,price,size,unit,weighed:false,taxPercent:null,currency:"CAD",available:"yes",substitution:false,approved:true,kind:"public",mode:"pickup",locality:"Fictional branch",localityConfirmed:true,matchNote:"Fictional exact product reviewed",evidence:{title:"Fictional source",url:"https://example.com/price",date:today,until:null}}]};}

test("four retailer aliases are canonicalized; leads cannot create a calculated or verified price",()=>{
 assert.equal(purchaseRetailerName("Freshstreet Market pickup"),"Fresh St. Market");assert.equal(purchaseRetailerName("Save on Food"),"Save-On-Foods");assert.equal(purchaseRetailerName("Unrelated shop"),"");
 const r=record("Honey Nut Cheerios"),p=planFor("Honey Nut Cheerios",430,"g",5),state=emptyPurchaseResolution();
 state.referenceLeads=validateReferenceLeads([{id:"lead",store:"Costco",family:"honey-nut-cheerios",product:"Fictional bulk cereal",sourceUrl:"https://example.com/unverified",date:today,note:"Search index only; no current primary price",reason:"Unverified price, outside coverage",indicativePrice:10,currency:"CAD"}]);
 const stores=purchaseScenarioStores(p,r,today,state);assert.equal(stores.length,4);assert.equal(stores.find(s=>s.name==="Costco")!.covered,0);assert.equal(stores.find(s=>s.name==="Costco")!.normalized,null);assert.equal(purchaseStoreComparisons(p,r,today).length,2);
});

test("a common count-to-mass hypothesis compares the same six minis across retailers and rounds full bulk packs",()=>{
 const r=record("Mini Cucumbers",{size:6,unit:"each"}),p=planFor("Mini Cucumbers reference 1 lb",453.59237,"g",3),state=emptyPurchaseResolution();
 for(const[id,name,size,price]of[["co","Costco",907.18474,4],["so","Save on Foods",454,5]] as const){p.retailers.push({...p.retailers[0],id,name,areaConfirmed:false,locality:"Nonlocal fictional"});p.prices.push({...p.prices[0],id,retailerId:id,product:name+" Mini Cucumbers",size,price,approved:false,substitution:true,locality:"Nonlocal fictional",localityConfirmed:false});}
 state.scenarioHints=[{id:"six",purpose:"count-equivalent",product:"Mini Cucumbers",productId:"11111111_EA",priceId:"price",priceKey:purchasePriceKey(p.prices[0]),size:453.59237,unit:"g",sourceCount:6,packagePrice:null,sourceUrl:"https://example.com/reference",observedAt:"2026-10-28T00:00:00.000Z",note:"Fictional explicit hypothesis: six minis share one pound, original mass unknown"}];
 const stores=purchaseScenarioStores(p,r,today,state),bulk=stores.find(s=>s.name==="Costco")!;assert.equal(bulk.normalized,2);assert.equal(bulk.outlay,4);assert.equal(bulk.nonlocal,true);assert.equal(bulk.lines[0].scenario!.size,453.59237);assert.equal(stores[0].normalized,3);
 r.receipt.items[0].quantity=2;assert.equal(purchaseScenarioStores(p,r,today,state).find(s=>s.name==="Costco")!.outlay,4);
 r.receipt.items[0].productReference={provider:"pcexpress",id:"22222222_EA"};assert.equal(purchaseScenarioStores(p,r,today,state).find(s=>s.name==="Costco")!.covered,0);
});

test("a source-bound inferred retailer format converts the price pack, never the original receipt; stale proof invalidates it",()=>{
 const r=record("Protein Tortillas",{size:342,unit:"g"}),p=planFor("Other Protein Tortillas 6 pack",6,"each",7),state=emptyPurchaseResolution();p.retailers[0].name="Fresh St. Market";p.prices[0].approved=false;p.prices[0].substitution=true;
 state.scenarioHints=[{id:"upc",purpose:"reference-format",product:p.prices[0].product,productId:"111111111111",priceId:"price",priceKey:purchasePriceKey(p.prices[0]),size:330,unit:"g",packagePrice:null,sourceUrl:"https://example.com/corroborated-upc",observedAt:"2026-10-28T00:00:00.000Z",note:"Inferred mass from a matching UPC on a second official source, not mass shown on this page"}];
 const s=purchaseScenarioStores(p,r,today,state).find(s=>s.name==="Fresh St. Market")!;assert.equal(s.estimated,1);assert.equal(s.normalized,7.25);assert.equal(s.outlay,14);assert.equal(r.receipt.items[0].size,342);assert.match(s.lines[0].scenario!.assumptions.join(" "),/inféré/);
 p.prices[0].price=8;assert.equal(purchaseScenarioStores(p,r,today,state).find(s=>s.name==="Fresh St. Market")!.covered,0);
});

test("whole-bean espresso references are coffee beans; ground espresso is not silently substituted",()=>{
 const r=record("Fictional Whole Bean Coffee",{size:1,unit:"kg"}),p=planFor("Other Whole Bean Espresso Dark Blend",300,"g",18);p.retailers[0].name="Save-On-Foods";
 assert.equal(purchaseScenarioStores(p,r,today).find(s=>s.name==="Save-On-Foods")!.estimated,1);p.prices[0].product="Other Ground Espresso Dark Blend";assert.equal(purchaseScenarioStores(p,r,today).find(s=>s.name==="Save-On-Foods")!.covered,0);
});

test("a historical selling-unit proof can estimate one sourced physical pack while known physical units remain binding",()=>{
 const r=record("Fictional Strawberries"),p=planFor("Other Strawberries",454,"g",5);
 p.purchaseComparisons=[{id:"old-unit",recordId:r.id,lineIndex:0,lineKey:purchaseLineKey(r.receipt.items[0]),priceId:"previous",priceKey:"previous",purpose:"comparison-only",relation:"equivalent-same-format",quantity:1,size:1,unit:"each",formatLabel:"Selling unit, physical size unknown",referenceFormatLabel:"Selling unit",sourceEstimate:null,sourceEstimateEvidence:"Unknown",provenance:"Fictional older selling-unit reference",reviewedAt:"2026-10-28T00:00:00.000Z"}];
 const before=JSON.stringify(r),s=purchaseScenarioStores(p,r,today)[0];assert.equal(s.estimated,1);assert.equal(s.normalized,5);assert.match(s.lines[0].scenario!.assumptions.join(" "),/unité de vente source.*paquet de référence/);assert.equal(JSON.stringify(r),before);
 r.receipt.items[0].size=1;r.receipt.items[0].unit="l";assert.equal(purchaseScenarioStores(p,r,today)[0].covered,0);
});

test("fruit-flavoured baby snacks are not fresh fruit and reversed English-cucumber naming reuses the source",()=>{
 const snack=record("Strawberry Banana Puffies Baby Snack",{size:50,unit:"g"}),p=planFor("Fresh Strawberries",454,"g",5);assert.equal(purchaseScenarioStores(p,snack,today)[0].covered,0);
 const cucumber=record("English Cucumber"),c=planFor("Cucumber English Sold in Single Wrap",1,"each",1.25);assert.equal(purchaseScenarioStores(c,cucumber,today)[0].estimated,1);
});
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
