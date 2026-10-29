import test from "node:test";
import assert from "node:assert/strict";
import { emptyReceipt, blankItem, validateReceipt, monthlySummary, type GroceryRecord } from "../../worker/src/grocery-model";
import { emptyPlan, emptyEvidence, type GroceryPlan } from "../../worker/src/grocery-planning";
import { purchaseComparison, purchaseStatus, purchaseDate, purchaseAmountLabel, recentPcExpressPurchases, purchaseStoreComparisons, purchaseLocalDate } from "../src/grocery-purchases";
import { reviewGroceries } from "../src/grocery-api";
import { purchaseLineKey, purchasePriceKey, validatePurchaseEvidence, purchaseEvidenceReason, validateSourceEstimates, estimatedSourceLine, type PurchaseComparisonEvidence } from "../../worker/src/grocery-purchase-evidence";
import { purchaseSourceSummary } from "../src/grocery-purchases";
import { groceryRequest } from "../src/grocery-api";
import { emptyPurchaseResolution, type PurchaseCandidate } from "../../worker/src/grocery-purchase-resolution";
import { purchaseLineBlockers } from "../src/grocery-purchases";

test("per-purchase format confirmation enables only eligible partial products and undo restores unknown coverage", () => {
  const f = purchaseFixture(), line = f.record.receipt.items[0];
  Object.assign(line, { size: null, unit: null, amount: null, uncertain: true });
  Object.assign(f.plan.prices[0], { product: line.product, substitution: false });
  f.plan.items[0].substitutions = false;
  f.record.receipt.items.push({ ...blankItem(), name: "Synthetic second unknown", product: "Synthetic second unknown" });
  const c: PurchaseCandidate = { id: "format", recordId: f.record.id, lineIndex: 0, lineKey: purchaseLineKey(line), product: line.product, brand: "Synthetic", productId: "12345678_EA", itemId: "eggs", size: 12, unit: "each", formatLabel: "12 pieces", formatBasis: "public-source", sourceUrl: "https://example.com/source", observedAt: "2026-10-20T12:00:00.000Z", note: "Synthetic evidence" };
  const state = { ...emptyPurchaseResolution(), candidates: [c] }, original = JSON.stringify(f);
  const run = () => purchaseComparison(f.plan, f.record, "2026-10-21", state).find(s => s.retailer.id === "store")!;
  assert.equal(run().covered, 0); assert.ok(purchaseLineBlockers(f.plan, f.record, 0, state, "2026-10-21").includes("Format d'achat inconnu"));
  state.decisions[c.id] = { state: "confirmed", at: "2026-10-21T12:00:00.000Z" };
  const result = run(); assert.equal(result.covered, 1); assert.equal(result.count, 2); assert.equal(result.complete, false); assert.ok(Math.abs(result.normalized! - 4.8) < .0001); assert.equal(result.outlay, 6); assert.equal(result.sourceEstimate, null);
  assert.equal(JSON.stringify(f), original); assert.equal(result.lines[0].line.uncertain, true); assert.equal(result.lines[0].formatEvidence?.id, c.id);
  f.plan.prices[0].evidence.date = "2026-09-01"; assert.equal(run().covered, 0); assert.ok(purchaseLineBlockers(f.plan, f.record, 0, state, "2026-10-21").some(r => /périmé/.test(r)));
  f.plan.prices[0].evidence.date = "2026-10-21"; f.plan.prices[0].localityConfirmed = false; assert.equal(run().covered, 0); assert.ok(purchaseLineBlockers(f.plan, f.record, 0, state, "2026-10-21").some(r => /non local/.test(r)));
  f.plan.prices[0].localityConfirmed = true; state.decisions[c.id].state = "unconfirmed"; assert.equal(run().covered, 0);
});

export function derivedComparisonFixture() {
  const f = purchaseFixture(), line = f.record.receipt.items[0], p = f.plan.prices[0];
  Object.assign(line, { name: "Synthetic product 1000g", product: "Synthetic product 1000g", quantity: 1, size: null, unit: null, amount: null, uncertain: true, evidence: "Synthetic source: one 1000g format; unit estimate 8.00 CAD; final paid unknown" });
  Object.assign(p, { product: "Synthetic equivalent format", size: 1, unit: "kg", price: 4, approved: false, mode: "unknown" });
  f.plan.items[0].substitutions = false; f.plan.retailers[0].areaConfirmed = false;
  f.record.receipt.sourceType = "confirmation";
  const e: PurchaseComparisonEvidence = { id: "synthetic-comparison", recordId: f.record.id, lineIndex: 0, lineKey: purchaseLineKey(line), priceId: p.id, priceKey: purchasePriceKey(p), purpose: "comparison-only", relation: "equivalent-same-format", quantity: 1, size: 1000, unit: "g", formatLabel: "1000 g", referenceFormatLabel: "1 kg", sourceEstimate: 8, sourceEstimateEvidence: "Synthetic estimated unit quote, not paid", provenance: "Explicit synthetic same-format comparison review; brand/SKU unknown", reviewedAt: "2026-10-21T18:00:00.000Z" };
  f.plan.purchaseComparisons = [e]; return f;
}
test("estimated source unit quote multiplies quantity once, independent of catalogue or physical size", () => {
  const f = derivedComparisonFixture(), line = f.record.receipt.items[0]; Object.assign(line, { amount: 0, quantity: 3, size: 2, unit: "l" }); delete f.plan.purchaseComparisons;
  const e = { id: "synthetic-unit-quote", recordId: f.record.id, lineIndex: 0, lineKey: purchaseLineKey(line), quantity: 3, unitPrice: 2.25, currency: "CAD", basis: "estimated-per-source-unit" as const, sourceEvidence: "Synthetic source quotes per ordered unit; zero total column is a placeholder", reviewedAt: "2026-10-21T18:00:00.000Z" };
  f.plan.sourceEstimates = validateSourceEstimates([e]); const original = JSON.stringify(f); assert.equal(estimatedSourceLine(f.plan.sourceEstimates, f.record, 0)?.amount, 6.75); assert.equal(purchaseSourceSummary(f.plan, f.record).subtotal, 6.75); assert.equal(purchaseSourceSummary(f.plan, f.record).difference, -1.75); assert.equal(JSON.stringify(f), original);
  f.plan.prices[0].price = 99; assert.equal(estimatedSourceLine(f.plan.sourceEstimates, f.record, 0)?.unitPrice, 2.25);
  for (const patch of [{ basis: "paid" }, { unitPrice: NaN }, { unitPrice: 1.001 }, { quantity: 0 }, { sourceEvidence: "" }]) assert.throws(() => validateSourceEstimates([{ ...e, ...patch }]));
  assert.throws(() => validateSourceEstimates([e, e])); f.plan.sourceEstimates.push({ ...e, id: "ambiguous" }); assert.equal(estimatedSourceLine(f.plan.sourceEstimates, f.record, 0), null); f.plan.sourceEstimates.pop(); line.quantity = 4; assert.equal(estimatedSourceLine(f.plan.sourceEstimates, f.record, 0), null); line.quantity = 3; f.record.receipt.sourceType = "final-receipt"; assert.equal(estimatedSourceLine(f.plan.sourceEstimates, f.record, 0), null);
});
test("unit quote capability is required before a source-estimate write", async () => {
  const old = globalThis.fetch; let calls = 0; globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ capabilities: ["grocery-planning-v1"] }), { status: 200 }); };
  try { await assert.rejects(groceryRequest({ Endpoint: "https://synthetic.invalid", ApiKey: "synthetic" }, "/groceries/planning", { plan: { sourceEstimates: [{}] } }), /prix unitaires source/); assert.equal(calls, 1); } finally { globalThis.fetch = old; }
});
test("explicit equivalent format comparison preserves raw uncertainty and buying permissions", () => {
  const f = derivedComparisonFixture(); f.record.receipt.items.push({ ...blankItem(), name: "Synthetic unknown line" }); const raw = JSON.stringify(f), r = compare(f);
  assert.equal(r.covered, 1); assert.equal(r.count, 2); assert.equal(r.complete, false); assert.equal(r.normalized, 4); assert.equal(r.sourceEstimate, 8); assert.equal(r.comparisonOnly, true); assert.equal(r.lines[0].calculated, false); assert.equal(r.lines[0].comparisonEvidence?.relation, "equivalent-same-format");
  assert.equal(JSON.stringify(f), raw); assert.equal(f.plan.items[0].substitutions, false); assert.equal(f.record.receipt.items[0].amount, null); assert.equal(f.record.receipt.items[0].uncertain, true); assert.equal(monthlySummary([f.record], "2026-10").currencies.length, 0);
});
test("derived evidence fails closed for stale source, price, format, dates and ambiguity", () => {
  for (const mutate of [(f: ReturnType<typeof derivedComparisonFixture>) => { f.record.receipt.items[0].evidence += " changed"; }, (f: ReturnType<typeof derivedComparisonFixture>) => { f.plan.prices[0].price += 1; }, (f: ReturnType<typeof derivedComparisonFixture>) => { f.plan.purchaseComparisons![0].size = 500; }, (f: ReturnType<typeof derivedComparisonFixture>) => { f.plan.purchaseComparisons!.push({ ...f.plan.purchaseComparisons![0], id: "another" }); }]) {
    const f = derivedComparisonFixture(); mutate(f); assert.equal(compare(f).covered, 0); assert.equal(compare(f).normalized, null);
  }
  const f = derivedComparisonFixture(); assert.equal(purchaseComparison(f.plan, f.record, "2026-10-30")[0].covered, 0); assert.equal(purchaseComparison(f.plan, f.record, "2026-10-20")[0].covered, 0);
});
test("comparison evidence validates shape, rejects SKU identities and mismatched source bindings", () => {
  const f = derivedComparisonFixture(), e = f.plan.purchaseComparisons![0]; assert.deepEqual(validatePurchaseEvidence([e]), [e]);
  for (const change of [{ relation: "identical-sku" }, { purpose: "cart-substitution" }, { provenance: "" }, { lineIndex: -1 }, { sourceEstimate: NaN }, { size: 0 }, { quantity: .5 }]) assert.throws(() => validatePurchaseEvidence([{ ...e, ...change }]));
  assert.throws(() => validatePurchaseEvidence([e, e])); const copy = structuredClone(f.record); copy.receipt.items[0].quantity = 2; assert.ok(purchaseEvidenceReason(e, copy, f.plan));
});
test("old worker cannot silently discard comparison evidence", async () => {
  const old = globalThis.fetch, calls: string[] = []; globalThis.fetch = async input => { calls.push(String(input)); return new Response(JSON.stringify({ capabilities: ["grocery-planning-v1"] }), { status: 200 }); };
  try { await assert.rejects(groceryRequest({ Endpoint: "https://synthetic.invalid", ApiKey: "synthetic" }, "/groceries/planning", { plan: derivedComparisonFixture().plan }), /preuves de comparaison/); assert.equal(calls.length, 1); assert.match(calls[0], /\/health$/); } finally { globalThis.fetch = old; }
});

export function purchaseFixture() {
  const plan: GroceryPlan = { ...emptyPlan(), items: [{ id: "eggs", name: "Synthetic eggs", quantity: 1, size: 12, unit: "each", preference: "", substitutions: true, active: true, origin: "manual", countUnit: "œufs" }],
    retailers: [{ id: "store", name: "Costco", membershipStatus: "existing", mode: "store", locality: "Synthetic branch", areaConfirmed: true, otherFeesReviewed: false, delivery: null, service: null, servicePercent: null, feesTaxPercent: null, minimum: null, freeDeliveryAbove: null, evidence: emptyEvidence() }],
    prices: [{ id: "price", itemId: "eggs", retailerId: "store", product: "Synthetic comparable eggs", substitution: true, approved: true, price: 6, size: 15, unit: "each", weighed: false, taxPercent: null, currency: "CAD", available: "yes", kind: "public", mode: "store", locality: "Synthetic branch", localityConfirmed: true, matchNote: "Same grade, type and quality reviewed", evidence: { title: "Synthetic public source", url: "https://example.com/eggs", date: "2026-10-21", until: "2026-10-23" } }] };
  const record: GroceryRecord = { id: "synthetic", revision: "r1", status: "saved", reviewedAt: "2026-10-21", extraction: "complete", createdAt: "2026-10-21", duplicateOf: null, sources: [{ hash: "abc", name: "synthetic.txt", type: "text/plain", size: 12 }], receipt: { ...emptyReceipt(), sourceType: "final-receipt", store: "Synthetic original store", currency: "CAD", date: "2026-10-19", total: 5, items: [{ ...blankItem(), name: "Synthetic eggs", product: "Synthetic original eggs", quantity: 1, size: 12, unit: "each", amount: 5, uncertain: false, evidence: "SOURCE 1: Article rapproché : eggs. 12 eggs 5.00" }] } };
  return { plan, record };
}
const compare = (f: ReturnType<typeof purchaseFixture>) => purchaseComparison(f.plan, f.record, "2026-10-21").find(r => r.retailer.id === "store")!;

test("Vancouver date keeps purchases and local price validity on the same day across UTC midnight", () => {
  assert.equal(purchaseLocalDate(new Date("2026-10-22T01:00:00Z")), "2026-10-21");
  assert.equal(purchaseLocalDate(new Date("2026-10-22T07:00:00Z")), "2026-10-22");
  const f = purchaseFixture(); f.plan.prices[0].evidence.until = "2026-10-21";
  assert.ok(purchaseComparison(f.plan, f.record, purchaseLocalDate(new Date("2026-10-22T01:00:00Z")))[0]);
  assert.equal(purchaseStoreComparisons(f.plan, f.record, "2026-10-21")[1].complete, true);
  assert.equal(purchaseStoreComparisons(f.plan, f.record, "2026-10-22")[1].complete, false);
});

test("recent PCX purchases require dated fulfillment or reviewed final receipt, never a current cart or scheduled confirmation", () => {
  const { record } = purchaseFixture(); record.receipt.store = "PC Express"; record.receipt.sourceType = "confirmation";
  assert.equal(recentPcExpressPurchases([record], "2026-10-21").length, 0);
  record.receipt.fulfillment = { date: "2026-10-19", evidence: "SOURCE 2: same order delivered" };
  assert.equal(recentPcExpressPurchases([record], "2026-10-21").length, 1);
  assert.equal(purchaseDate(record), "2026-10-19"); assert.equal(purchaseAmountLabel(record), "Total estimé");
  const old = structuredClone(record); old.id = "old"; old.receipt.fulfillment!.date = "2026-09-01";
  const future = structuredClone(record); future.id = "future"; future.receipt.fulfillment!.date = "2026-10-22";
  const draft = { ...record, id: "draft", status: "draft" as const }, duplicate = { ...record, id: "duplicate", duplicateOf: record.id };
  const before = JSON.stringify([old, record, future, draft, duplicate]);
  assert.deepEqual(recentPcExpressPurchases([old, record, future, draft, duplicate], "2026-10-21").map(r => r.id), [record.id]);
  assert.equal(JSON.stringify([old, record, future, draft, duplicate]), before);
  delete record.receipt.fulfillment; record.receipt.sourceType = "final-receipt";
  assert.equal(recentPcExpressPurchases([record], "2026-10-21").length, 1); assert.equal(purchaseAmountLabel(record), "Total payé");
});
test("fulfillment is additive, evidence-required and never upgrades estimated payment", () => {
  const { record } = purchaseFixture(); record.receipt.sourceType = "confirmation";
  const receipt = validateReceipt({ ...record.receipt, fulfillment: { date: "2026-10-19", evidence: "SOURCE 2 delivered" } });
  assert.equal(receipt.fulfillment?.date, "2026-10-19"); assert.equal(receipt.sourceType, "confirmation");
  for (const f of [{ date: "2026-02-30", evidence: "test" }, { date: "2026-10-19", evidence: "" }]) assert.throws(() => validateReceipt({ ...record.receipt, fulfillment: f }));
  assert.equal(validateReceipt({ ...record.receipt, fulfillment: null }).fulfillment, undefined);
  assert.equal(validateReceipt(record.receipt).fulfillment, undefined);
});
test("Walmart and Costco summaries select a single local mode and expose missing/partial coverage without assembling branches", () => {
  const f = purchaseFixture(), second = { ...f.plan.retailers[0], id: "other-mode", mode: "delivery" as const };
  f.plan.retailers.push(second);
  const stores = purchaseStoreComparisons(f.plan, f.record, "2026-10-21");
  assert.deepEqual(stores.map(s => s.name), ["Walmart", "Costco"]); assert.equal(stores[0].complete, false); assert.equal(stores[0].normalized, null); assert.equal(stores[1].retailer.id, "store");
  f.record.receipt.items.push({ ...f.record.receipt.items[0], product: "Unknown source item", evidence: "Unlinked source row" });
  const partial = purchaseStoreComparisons(f.plan, f.record, "2026-10-21")[1]; assert.equal(partial.covered, 1); assert.equal(partial.count, 2); assert.equal(partial.complete, false); assert.ok(partial.normalized! > 0);
});
test("Calculé is reserved for prorata rather than every changed pack size", () => {
  const f = purchaseFixture(); f.record.receipt.items[0].quantity = 2; f.plan.prices[0].size = 24;
  assert.equal(compare(f).lines[0].calculated, false); assert.equal(compare(f).normalized, compare(f).outlay);
});
test("delivery metadata cannot be silently dropped by an older worker", async () => {
  const f = purchaseFixture(); f.record.receipt.fulfillment = { date: "2026-10-19", evidence: "Delivered source" };
  const original = globalThis.fetch; let calls = 0;
  try { globalThis.fetch = (async () => { calls++; return new Response(JSON.stringify({ capabilities: ["grocery-source-type-v1"] })); }) as typeof fetch;
    await assert.rejects(reviewGroceries({ Endpoint: "http://127.0.0.1:9999", ApiKey: "synthetic" }, f.record, f.record.receipt, true, true, false), /preuve de livraison/); assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});
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
