import test from "node:test";
import assert from "node:assert/strict";
import { emptyPlan, type GroceryPlan, type GroceryPrice, type ShoppingItem } from "../../worker/src/grocery-planning";
import { emptyReceipt, type GroceryRecord } from "../../worker/src/grocery-model";
import { currentCart, filterCatalogue, householdCatalogue, parseCartSnapshot, targetSavings, savingLabel, validateCataloguePlan, type PCExpressCartSnapshot } from "../src/grocery-catalogue";
const now = "2026-10-13", timestamp = now + "T12:00:00Z";
const item = (id: string, patch: Partial<ShoppingItem> = {}): ShoppingItem => ({ id, name: "Synthetic product " + id, quantity: null, size: null, unit: "kg", preference: "keep", substitutions: false, active: false, origin: "synthetic", cadence: "unknown", ...patch });
function fixture(): GroceryPlan {
  const plan = emptyPlan(); plan.area = "Synthetic city"; plan.areaConfirmed = true;
  plan.items = [item("coffee"), item("oats", { cadence: "month", every: 2 }), item("unpriced"), item("old")];
  plan.retailers = ["Superstore", "Walmart", "Costco"].map((name, i) => ({ id: "r" + i, name, delivery: null, service: null, servicePercent: null, feesTaxPercent: null, minimum: null, freeDeliveryAbove: null, areaConfirmed: true, otherFeesReviewed: false, mode: "store", locality: plan.area, evidence: { title: "Synthetic source", url: "https://example.com/synthetic", date: now, until: null } }));
  const offer = (id: string, itemId: string, retailerId: string, price: number, size: number, patch: Partial<GroceryPrice> = {}): GroceryPrice => ({ id, itemId, retailerId, product: "Synthetic exact " + itemId, price, size, unit: "g", weighed: false, taxPercent: null, currency: "CAD", available: "yes", approved: true, substitution: false, kind: "public", mode: "store", locality: plan.area, localityConfirmed: true, evidence: plan.retailers[0].evidence, ...patch });
  plan.prices = [offer("s", "coffee", "r0", 10, 500), offer("w", "coffee", "r1", 16, 1000), offer("c", "coffee", "r2", 5, 250), offer("o", "oats", "r1", 1, 500)];
  return plan;
}
const snapshot = (items: PCExpressCartSnapshot["items"] = [{ itemId: "coffee", product: "Synthetic exact coffee", brand: "Synthetic brand", size: 500, unit: "g", quantity: 2 }]): PCExpressCartSnapshot => ({ schema: 1, source: "pcexpress", capturedAt: timestamp, complete: true, items });
const receipt = (id = "ticket"): GroceryRecord => ({ id, revision: "1", status: "saved", createdAt: timestamp, sources: [], extraction: "complete", reviewedAt: timestamp, duplicateOf: null, receipt: { ...emptyReceipt(), store: "Synthetic store", date: now, items: [{ name: "Observed oats", product: "Synthetic branded oats", amount: null, quantity: null, size: 750, unit: "g", evidence: "Article rapproché : oats.", uncertain: false }, { name: "Receipt-only product", product: "Synthetic soap", amount: null, quantity: null, size: null, unit: null, evidence: "Confirmed source label", uncertain: false }] } });

test("Catalogue keeps all inactive, unpriced and confirmed receipt/cart-only products without changing plan/cadences", () => {
  const plan = fixture(), records = [receipt(), receipt("second")], cart = snapshot([...snapshot().items, { itemId: null, product: "Synthetic cart-only", brand: null, size: null, unit: null, quantity: null }]);
  const before = structuredClone({ plan, records, cart }), rows = householdCatalogue(plan, records, cart);
  assert.equal(rows.length, 6); for (const i of plan.items) assert.ok(rows.some(r => r.item === i));
  assert.equal(rows.find(r => r.item.id === "oats")!.item.every, 2);
  assert.equal(rows.find(r => r.item.name === "Receipt-only product")!.item.cadence, "unknown");
  assert.equal(rows.find(r => r.item.id === "coffee")!.identities[0].brand, "Synthetic brand");
  assert.deepEqual({ plan, records, cart }, before);
});
test("Independent combined filters use only current explicit PCExpress membership, never weekly selection", () => {
  const plan = fixture(); plan.items[1].active = true;
  const cart = snapshot(), rows = householdCatalogue(plan, [receipt()], cart), time = Date.parse(timestamp);
  assert.equal(filterCatalogue(rows, "all", "", cart, time).length, 5);
  assert.deepEqual(filterCatalogue(rows, "cart", "", cart, time).map(r => r.item.id), ["coffee"]);
  assert.equal(filterCatalogue(rows, "cart", "oats", cart, time).length, 0);
  assert.equal(filterCatalogue(rows, "cart", "synthetic brand", cart, time).length, 1);
  for (const c of [null, { ...cart, complete: false }, { ...cart, capturedAt: "2020-01-01T00:00:00Z" }, { ...cart, capturedAt: "2099-01-01T00:00:00Z" }]) assert.equal(filterCatalogue(rows, "cart", "", c, time).length, 0);
  assert.equal(currentCart(snapshot([]), time), true);
});
test("Empty current snapshot produces an empty basket; uncertain tickets cannot add household identities", () => {
  const plan = fixture(), record = receipt(); record.receipt.items.forEach(i => i.uncertain = true);
  assert.equal(householdCatalogue(plan, [record], null).length, plan.items.length);
  assert.equal(filterCatalogue(householdCatalogue(plan, [], snapshot([])), "cart", "", snapshot([]), Date.parse(timestamp)).length, 0);
  for (const patch of [{ duplicateOf: "previous" }, { reviewedAt: null }, { extraction: "running" as const }, { status: "draft" as const }]) assert.equal(householdCatalogue(plan, [{ ...receipt(), ...patch }], null).length, plan.items.length);
});
test("Private snapshot parser admits null unknowns, bounds lines, strips unrelated fields and rejects weekly lists", () => {
  assert.deepEqual(parseCartSnapshot({ ...snapshot(), address: "discarded" }), snapshot());
  for (const invalid of [fixture(), { ...snapshot(), source: "weekly" }, { ...snapshot(), capturedAt: "nonsense" }, { ...snapshot(), items: [{ ...snapshot().items[0], quantity: -1 }] }, { ...snapshot(), items: Array(301).fill(snapshot().items[0]) }]) assert.throws(() => parseCartSnapshot(invalid));
});
test("Conflicting receipt associations and distinct variants remain separate, never silently merged", () => {
  const plan = fixture(), record = receipt();
  record.receipt.items = [{ ...record.receipt.items[0], name: plan.items[0].name, product: plan.items[0].name, evidence: "Article rapproché : absent." }, { ...record.receipt.items[0], name: "Synthetic apples", product: "Synthetic Envy apples", evidence: "Reviewed variant" }, { ...record.receipt.items[0], name: "Synthetic apples", product: "Synthetic small apples", evidence: "Reviewed variant" }];
  const rows = householdCatalogue(plan, [record], null);
  assert.equal(rows.length, plan.items.length + 3); assert.equal(rows.find(r => r.item.id === "coffee")!.identities.length, 0);
  assert.ok(rows.some(r => r.identities.some(p => p.product === "Synthetic Envy apples"))); assert.ok(rows.some(r => r.identities.some(p => p.product === "Synthetic small apples")));
});
test("Target converts g/kg and computes 20% versus Superstore, not 25% versus cheapest; no fictitious 50% coffee", () => {
  const plan = fixture(), before = structuredClone(plan), result = targetSavings(plan, plan.items, now);
  assert.equal(result.result.length, 1); assert.equal(result.result[0].alternative.r.name, "Walmart"); assert.equal(result.result[0].percent, 20); assert.equal(result.result[0].difference, 4);
  assert.deepEqual(result.excluded.map(i => i.id), ["oats", "unpriced", "old"]); assert.deepEqual(plan, before);
  assert.equal(savingLabel(.01), "<0,1 %");
});
test("Missing/zero/old reference, incompatible unit, mode, currency, locality, quality and availability never recommend", () => {
  for (const patch of [{ price: 0 }, { approved: false }, { kind: "receipt" }, { available: "unknown" }, { available: "no" }, { localityConfirmed: false }, { locality: "Elsewhere" }, { mode: "delivery" }, { currency: "USD" }, { unit: "l" }, { product: "Different quality" }, { evidence: { ...fixture().prices[0].evidence, date: "2000-01-01" } }, { evidence: { ...fixture().prices[0].evidence, until: "2026-10-12" } }] as Partial<GroceryPrice>[]) {
    const plan = fixture(); plan.prices[0] = { ...plan.prices[0], ...patch };
    assert.equal(targetSavings(plan, plan.items, now).result.length, 0, JSON.stringify(patch));
  }
  const plan = fixture(); plan.prices = plan.prices.filter(p => p.retailerId !== "r0"); assert.equal(targetSavings(plan, plan.items, now).result.length, 0);
});
test("Visible reviewed substitutions require household permission and a quality note; ml/l stays separate from kg", () => {
  const plan = fixture(); plan.prices[1].product = "Synthetic equivalent"; plan.prices[1].substitution = true;
  assert.equal(targetSavings(plan, plan.items, now).result.length, 0);
  plan.items[0].substitutions = true; plan.prices[1].matchNote = "Reviewed same quality";
  assert.equal(targetSavings(plan, plan.items, now).result[0].alternative.p.substitution, true);
  plan.items[0].unit = "l"; plan.prices[0].unit = "ml"; plan.prices[1].unit = "l"; plan.prices[1].size = 1;
  assert.equal(targetSavings(plan, plan.items, now).result[0].percent, 20);
});
test("Catalogue may display more than 60 articles without a destructive plan migration", () => {
  const plan = fixture(); plan.items = Array.from({ length: 67 }, (_, n) => item("i" + n));
  const cart = snapshot(Array.from({ length: 23 }, (_, n) => ({ itemId: null, product: "Synthetic new " + n, brand: null, size: null, unit: null, quantity: null })));
  const rows = householdCatalogue(plan, [], cart); assert.equal(rows.length, 90); assert.equal(plan.items.length, 67);
});
test("Catalogue reader admits a larger synthetic plan, with existing validation and no dropped prices", () => {
  const plan = fixture(); plan.items.push(...Array.from({ length: 73 }, (_, n) => item("new" + n)));
  plan.prices.push({ ...plan.prices[0], id: "lastprice", itemId: "new72" });
  const before = structuredClone(plan), result = validateCataloguePlan(plan); assert.equal(result.items.length, 77); assert.equal(result.prices.length, 5); assert.deepEqual(plan, before);
  for (const invalid of [{ ...plan, items: [...plan.items, plan.items[0]] }, { ...plan, prices: [...plan.prices, { ...plan.prices[0], itemId: "absent" }] }, { ...plan, items: Array.from({ length: 301 }, (_, n) => item("n" + n)) }, { ...plan, items: [...plan.items.slice(0, 61), { ...plan.items[61], cadence: "invented" }] }]) assert.throws(() => validateCataloguePlan(invalid));
});
