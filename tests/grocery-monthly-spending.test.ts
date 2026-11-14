import test from "node:test";
import assert from "node:assert/strict";
import { pcExpressMonthlySpending } from "../apps/web/src/grocery-monthly-spending.ts";
import { emptyReceipt, type GroceryRecord } from "../apps/worker/src/grocery-model.ts";
const make = (id: string, total = 12.34, type: "confirmation" | "final-receipt" | "unknown" = "confirmation", date = "2026-10-24"): GroceryRecord => ({ id, revision: "1", status: "saved", createdAt: date + "T12:00:00Z", reviewedAt: type === "final-receipt" ? date : null, sources: [], extraction: "complete", duplicateOf: null, receipt: { ...emptyReceipt(), store: "PC Express", sourceType: type, total, date, currency: "CAD" } });
test("separates final verified receipts from estimates and sums integer cents", () => {
  const records = [make("a", .1, "final-receipt"), make("b", .2, "final-receipt"), make("c", 100), make("d", 7, "confirmation", "2026-11-01")];
  const before = JSON.stringify(records), result = pcExpressMonthlySpending(records);
  assert.deepEqual(result.months, [{month:"2026-10",currency:"CAD",paid:.3,estimated:100,paidCount:2,estimatedCount:1},{month:"2026-11",currency:"CAD",paid:0,estimated:7,paidCount:0,estimatedCount:1}]);
  assert.equal(JSON.stringify(records), before);
});
test("deduplicates the same order across mailboxes and prefers final receipt", () => {
  const a = make("kevin", 100), b = make("jasmine", 100), c = make("final", 93, "final-receipt");
  for (const r of [a,b,c]) r.receipt.reference = "Order # 123456789012345";
  const result = pcExpressMonthlySpending([a,b,c]);
  assert.equal(result.months[0].paid,93); assert.equal(result.months[0].estimated,0); assert.equal(result.duplicates,2);
});
test("does not invent identity from matching price/date", () => {
  const result = pcExpressMonthlySpending([make("a"),make("b")]);
  assert.equal(result.months[0].estimated,24.68); assert.equal(result.months[0].estimatedCount,2);
});
test("conflicting same-order sources are excluded", () => {
  const a=make("a",10),b=make("b",11); a.receipt.reference=b.receipt.reference="123456789012345";
  const result=pcExpressMonthlySpending([a,b]); assert.equal(result.months.length,0); assert.equal(result.conflicts,1);
});
test("missing fields and unreviewed final receipts do not count as paid", () => {
  const a=make("unknown",100,"unknown"),b=make("undated"),c=make("unreviewed",40,"final-receipt"),d=make("currency"); b.receipt.date=null;c.reviewedAt=null;d.receipt.currency=null;
  const result=pcExpressMonthlySpending([a,b,c,d]);assert.equal(result.months.length,0);assert.equal(result.excluded,4);
});
test("does not add unknown months, drafts, duplicates, other stores, or authorizations", () => {
  const a=make("first"),b=make("draft"),c=make("duplicate"),d=make("other"),e=make("last",20,"confirmation","2026-12-01");b.status="draft";c.duplicateOf=a.id;d.receipt.store="Other store";
  a.receipt.warnings=["Card authorization 999.00 CAD, not a charge"]; a.receipt.fulfillment={date:"2026-11-01",evidence:"Delivered"};
  const result=pcExpressMonthlySpending([a,b,c,d,e]);assert.deepEqual(result.months.map(m=>m.month),["2026-10","2026-12"]);assert.equal(result.months[0].estimated,12.34);assert.equal(result.firstDate,"2026-10-24");
});
test("currencies and source years remain separate",()=>{
 const a=make("a"),b=make("b",10,"final-receipt","2025-01-01"),c=make("c");c.receipt.currency="USD";
 assert.deepEqual(pcExpressMonthlySpending([a,b,c]).months.map(m=>[m.month,m.currency]),[["2025-01","CAD"],["2026-10","CAD"],["2026-10","USD"]]);
});
test("conflicting explicit order identities cannot inflate monthly totals",()=>{
 const a=make("a");a.receipt.reference="123456789012345";a.automaticImport={kind:"pc-express-gmail",orderId:"999456789012345",importedAt:"2026-11-14T00:00:00Z",sourceMessageIds:[]};
 const result=pcExpressMonthlySpending([a]);assert.equal(result.months.length,0);assert.equal(result.conflicts,1);
});
