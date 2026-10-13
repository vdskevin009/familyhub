import test from "node:test";
import assert from "node:assert/strict";
import { emptyPlan, type GroceryPlan } from "../../worker/src/grocery-planning";
import { emptyReceipt, blankItem, type GroceryRecord } from "../../worker/src/grocery-model";
import { receiptProducts, receiptPreference, publicProductResearch } from "../src/grocery-receipt-products";
function fixture() {
 const plan = emptyPlan(); plan.items = [{ id: "coffee", name: "Synthetic coffee", quantity: null, size: null, unit: null, preference: "Keep large packs; private household note", active: true, substitutions: false, origin: "" }];
 const record: GroceryRecord = { id: "ticket-one", revision: "r", status: "saved", extraction: "complete", createdAt: "2026-10-12", reviewedAt: "2026-10-12", duplicateOf: null, sources: [], receipt: { ...emptyReceipt(), store: "Synthetic market", date: "2026-10-12", items: [{ ...blankItem(), name: "Synthetic coffee", product: "ExampleBrand roasted coffee", uncertain: false, evidence: "Private source information" }] } };
 return { plan, record };
}
test("Receipt products: confirmed identity needs no price/quantity, preserves plan and only sends reviewed product to research", () => {
 const { plan, record } = fixture(), before = structuredClone({plan, record}); const products = receiptProducts(plan, [record]);
 assert.equal(products.length, 1); assert.equal(products[0].product, "ExampleBrand roasted coffee");
 assert.deepEqual(publicProductResearch(products[0].product, "Montréal", true), { product: "ExampleBrand roasted coffee", area: "Montréal", confirmed: true });
 assert.deepEqual({plan, record}, before);
});
test("Receipt products: uncertain, unsaved, running, unreviewed, duplicate and missing identity/evidence excluded", () => {
 for (const patch of [{ status: "draft" }, { extraction: "running" }, { reviewedAt: null }, { duplicateOf: "original" }]) { const {plan, record}=fixture(); Object.assign(record, patch); assert.deepEqual(receiptProducts(plan, [record]), []); }
 for (const patch of [{ uncertain:true }, { product:"" }, { evidence:"" }]) { const {plan, record}=fixture(); Object.assign(record.receipt.items[0], patch); assert.deepEqual(receiptProducts(plan, [record]), []); }
});
test("Receipt products: explicit exact associations handle abbreviated receipt names but never fuzzy or nonexistent IDs", () => {
 const {plan, record}=fixture(); record.receipt.items[0].name="EXBR CF";
 assert.equal(receiptProducts(plan,[record]).length,0);
 record.receipt.items[0].evidence="Source. Article rapproché : coffee."; assert.equal(receiptProducts(plan,[record])[0].itemId,"coffee");
 record.receipt.items[0].evidence="Source. Article rapproché : coffee-other."; assert.equal(receiptProducts(plan,[record]).length,0);
 record.receipt.items[0].evidence="Article rapproché : coffee. Article rapproché : other."; assert.equal(receiptProducts(plan,[record]).length,0);
});
test("Receipt products: ambiguous exact names excluded; distinct brands retained and duplicate observations collapsed", () => {
 const {plan, record}=fixture(); plan.items.push({...plan.items[0],id:"other"}); assert.equal(receiptProducts(plan,[record]).length,0);
 plan.items.pop(); const second=structuredClone(record); second.id="ticket-two"; second.receipt.items[0].product="OtherBrand roasted coffee";
 assert.equal(receiptProducts(plan,[record,second,record]).length,2);
});
test("Receipt products: historical price associations require exact product and exact source ticket, never public observations", () => {
 const {plan,record}=fixture(); record.receipt.items[0].name="ABBREV";
 const price={id:"p",itemId:"coffee",retailerId:"r",product:record.receipt.items[0].product,kind:"receipt",evidence:{title:"Ticket ticket-one — Synthetic",url:"",date:"2026-10-12",until:null}};
 plan.prices=[price] as GroceryPlan["prices"]; assert.equal(receiptProducts(plan,[record]).length,1);
 price.evidence.title="Ticket ticket-one-extra"; assert.equal(receiptProducts(plan,[record]).length,0);
 price.evidence.title="Ticket ticket-one"; price.kind="public"; assert.equal(receiptProducts(plan,[record]).length,0);
});
test("Receipt preferences: explicit addition retains manual choices; no duplicate, truncation or inferred exclusivity", () => {
 const {plan}=fixture(), item=plan.items[0];
 assert.equal(receiptPreference(item,"ExampleBrand coffee"), item.preference+" · Produit observé sur ticket : ExampleBrand coffee");
 assert.equal(receiptPreference({...item,preference:"ExampleBrand coffee"},"ExampleBrand coffee"),null);
 assert.equal(receiptPreference({...item,preference:"x".repeat(490)},"ExampleBrand coffee"),null);
 assert.throws(()=>publicProductResearch("x".repeat(81),"Montréal",false)); assert.throws(()=>publicProductResearch(" ","Montréal",true));
});

test("Receipt products: saved manual transcription does not require automated extraction", () => { for (const extraction of ["pending", "failed"] as const) { const {plan,record}=fixture(); record.extraction=extraction; assert.equal(receiptProducts(plan,[record]).length,1); } });
