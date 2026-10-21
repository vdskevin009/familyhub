import test from "node:test";
import assert from "node:assert/strict";
import { emptyReceipt, blankItem, validateReceipt, monthlySummary, type GroceryRecord } from "../../worker/src/grocery-model";
import { emptyPlan, emptyEvidence, type GroceryPlan } from "../../worker/src/grocery-planning";
import { purchaseComparison, purchaseStatus } from "../src/grocery-purchases";
import { reviewGroceries } from "../src/grocery-api";

export function purchaseFixture() {
  const plan: GroceryPlan = { ...emptyPlan(), items: [{ id: "eggs", name: "Synthetic eggs", quantity: 1, size: 12, unit: "each", preference: "", substitutions: true, active: true, origin: "manual", countUnit: "œufs" }],
    retailers: [{ id: "store", name: "Costco", membershipStatus: "existing", mode: "store", locality: "Synthetic branch", areaConfirmed: true, otherFeesReviewed: false, delivery: null, service: null, servicePercent: null, feesTaxPercent: null, minimum: null, freeDeliveryAbove: null, evidence: emptyEvidence() }],
    prices: [{ id: "price", itemId: "eggs", retailerId: "store", product: "Synthetic comparable eggs", substitution: true, approved: true, price: 6, size: 15, unit: "each", weighed: false, taxPercent: null, currency: "CAD", available: "yes", kind: "public", mode: "store", locality: "Synthetic branch", localityConfirmed: true, matchNote: "Same grade, type and quality reviewed", evidence: { title: "Synthetic public source", url: "https://example.com/eggs", date: "2026-10-21", until: "2026-10-23" } }] };
  const record: GroceryRecord = { id: "synthetic", revision: "r1", status: "saved", reviewedAt: "2026-10-21", extraction: "complete", createdAt: "2026-10-21", duplicateOf: null, sources: [{ hash: "abc", name: "synthetic.txt", type: "text/plain", size: 12 }], receipt: { ...emptyReceipt(), sourceType: "final-receipt", store: "Synthetic original store", currency: "CAD", date: "2026-10-19", total: 5, items: [{ ...blankItem(), name: "Synthetic eggs", product: "Synthetic original eggs", quantity: 1, size: 12, unit: "each", amount: 5, uncertain: false, evidence: "SOURCE 1: Article rapproché : eggs. 12 eggs 5.00" }] } };
  return { plan, record };
}
const compare = (f: ReturnType<typeof purchaseFixture>) => purchaseComparison(f.plan, f.record, "2026-10-21").find(r => r.retailer.id === "store")!;
test("12 eggs normalized from actual 15-egg pack, separate whole-pack outlay, no mutation", () => {
  const f = purchaseFixture(), before = JSON.stringify(f), result = compare(f);
  assert.equal(result.normalized, 4.800000000000001); assert.equal(result.outlay, 6); assert.equal(result.lines[0].price?.size, 15); assert.equal(result.lines[0].calculated, true); assert.equal(result.lines[0].packs, 1); assert.equal(result.complete, true); assert.equal(JSON.stringify(f), before);
});
test("same format has no calculation badge, additional packs round up", () => {
  const f = purchaseFixture(); f.plan.prices[0].size = 12;
  assert.equal(compare(f).lines[0].calculated, false);
  f.record.receipt.items[0].quantity = 2; assert.equal(compare(f).outlay, 12); assert.equal(compare(f).lines[0].calculated, false);
  f.plan.prices[0].size = 15; assert.equal(compare(f).outlay, 12); assert.equal(compare(f).lines[0].packs, 2);
});
test("repeat physical lines share packs in basket outlay", () => {
  const f = purchaseFixture(); f.record.receipt.items[0].size = 6; f.record.receipt.items.push(structuredClone(f.record.receipt.items[0]));
  assert.equal(compare(f).outlay, 6); assert.equal(compare(f).covered, 2);
});
test("partial coverage never produces a complete basket or zero for absent retailer", () => {
  const f = purchaseFixture(); f.record.receipt.items.push({ ...blankItem(), name: "Unknown butter substitution" });
  const r = compare(f); assert.equal(r.complete, false); assert.equal(r.covered, 1); assert.ok(r.lines[1].reason);
  assert.equal(purchaseComparison(f.plan, f.record, "2026-10-21").find(r => r.retailer.name === "Save-On-Foods")!.normalized, null);
});
test("incompatible units, unavailable stock, uncertain match, stale price and conditional loyalty fail closed", () => {
  for (const patch of [{ unit: "kg" }, { available: "no" }, { available: "unknown" }, { approved: false }, { localityConfirmed: false }, { matchNote: "Member loyalty price" }, { evidence: { ...purchaseFixture().plan.prices[0].evidence, date: "2026-09-01" } }, { currency: "USD" }]) {
    const f = purchaseFixture(); Object.assign(f.plan.prices[0], patch); assert.equal(compare(f).normalized, null, JSON.stringify(patch)); assert.ok(compare(f).lines[0].reason);
  }
});
test("tax and fees remain excluded even when unknown; price is not a final order total", () => {
  const f = purchaseFixture(); f.plan.prices[0].taxPercent = 12; f.plan.prices[0].depositPerPack = 2;
  assert.equal(compare(f).outlay, 6); assert.equal(compare(f).lines[0].price?.taxPercent, 12);
});
test("source type preserves legacy schema and confirmations never claim paid", () => {
  const f = purchaseFixture(); assert.match(purchaseStatus(f.record), /payé/);
  delete f.record.receipt.sourceType; assert.match(purchaseStatus(f.record), /à vérifier/); assert.equal(validateReceipt(f.record.receipt).sourceType, undefined);
  f.record.receipt.sourceType = "confirmation"; assert.match(purchaseStatus(f.record), /Confirmation originale/);
  assert.equal(monthlySummary([f.record], "2026-10").currencies.length, 0);
  assert.equal(validateReceipt(f.record.receipt).sourceType, "confirmation"); assert.throws(() => validateReceipt({ ...f.record.receipt, sourceType: "paid-order" }));
  delete f.record.receipt.sourceType; f.record.sources[0].name = "original-confirmation.txt";
  assert.match(purchaseStatus(f.record), /Confirmation originale/); assert.equal(monthlySummary([f.record], "2026-10").currencies.length, 0);
  f.record.receipt.sourceType = "final-receipt"; assert.match(purchaseStatus(f.record), /payé/);
});
test("source classification gate prevents an older worker dropping metadata and leaves draft unchanged", async () => {
  const f = purchaseFixture(), before = JSON.stringify(f.record), originalFetch = globalThis.fetch, calls: string[] = [];
  try {
    globalThis.fetch = (async (url: string) => { calls.push(url); return new Response(JSON.stringify({ capabilities: ["grocery-receipts-v1"] }), { status: 200 }); }) as typeof fetch;
    await assert.rejects(reviewGroceries({ Endpoint: "http://127.0.0.1:9999", ApiKey: "synthetic" }, f.record, f.record.receipt, true, true, false), /worker PC/);
    assert.equal(calls.length, 1); assert.ok(calls[0].endsWith("/health")); assert.equal(JSON.stringify(f.record), before);
  } finally { globalThis.fetch = originalFetch; }
});
test("quality contradictions and ambiguous alternatives remain excluded despite approved flags", () => {
  const f = purchaseFixture(); f.plan.prices[0].product = "Synthetic fresh chicken"; assert.equal(compare(f).normalized, null);
  const g = purchaseFixture(); g.plan.prices.push({ ...g.plan.prices[0], id: "second-reference" }); assert.equal(compare(g).normalized, null); assert.match(compare(g).lines[0].reason, /Plusieurs/);
  const h = purchaseFixture(); h.plan.retailers[0].membershipStatus = "unknown"; assert.equal(compare(h).normalized, null); assert.match(compare(h).lines[0].reason, /Adhésion/);
});
