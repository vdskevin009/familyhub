import test from "node:test";
import assert from "node:assert/strict";
import { emptyPlan, type GroceryPrice, type ShoppingItem } from "../../worker/src/grocery-planning";
import { retailerTemplate } from "../../worker/src/grocery-weekly";
import { commonQuantityComparison } from "../src/grocery-common-quantity";
const day = "2026-10-12", evidence = { title: "Synthetic", url: "https://example.com", date: day, until: null };
const item: ShoppingItem = { id: "i", name: "Synthetic eggs", quantity: 2, size: 12, unit: "each", measure: "pack", countUnit: "œufs", active: true, substitutions: true, preference: "", origin: "synthetic" };
function fixture() {
  const p = emptyPlan(); p.items = [{ ...item }];
  p.retailers = ["Walmart", "Superstore"].map((name, n) => ({ ...retailerTemplate(`r${n}`, name), mode: "pickup" as const }));
  p.prices = p.retailers.map((r, n): GroceryPrice => ({ id: `p${n}`, itemId: "i", retailerId: r.id, product: "Synthetic equivalent candidate", price: n ? 6 : 3, size: n ? 20 : 12, unit: "each", weighed: false, taxPercent: null, depositPerPack: null, currency: "CAD", available: "unknown", substitution: true, approved: false, kind: "public", mode: "pickup", evidence })); return p;
}
test("Common basket: different pack sizes use identical physical quantity, separate whole purchase and preserve data", () => {
  const p = fixture(), before = structuredClone(p), c = commonQuantityComparison(p, day), w = c.stores.find(s => s.group.name === "Walmart")!, s = c.stores.find(s => s.group.name === "Superstore")!;
  assert.equal(c.count, 1); assert.equal(w.lines[0].quantity, 24); assert.equal(w.amount, 6); assert.ok(Math.abs(s.amount! - 7.2) < 1e-10); assert.equal(s.lines[0].purchase, 12); assert.equal(s.lines[0].packs, 2); assert.ok(Math.abs(s.percent! - 20) < 1e-10); assert.deepEqual(p, before);
});
test("Common basket: choose closest compatible pack, not the cheapest bulk pack", () => {
  const p = fixture(); p.prices.push({ ...p.prices[0], id: "bulk", size: 120, price: 10 });
  assert.equal(commonQuantityComparison(p, day).stores.find(s => s.group.name === "Walmart")!.lines[0].offer.p.id, "p0");
});
test("Common basket: same shared subset prevents unequal coverage from claiming a low total", () => {
  const p = fixture(); p.items.push({ ...item, id: "missing", name: "Synthetic missing article" }); p.prices.push({ ...p.prices[0], id: "missing-w", itemId: "missing", price: 999 });
  const c = commonQuantityComparison(p, day); assert.equal(c.count, 1); assert.equal(c.total, 2); assert.deepEqual(c.excluded.map(i => i.id), ["missing"]); assert.equal(c.stores.find(s => s.group.name === "Walmart")!.amount, 6);
});
test("Common basket: g/kg and ml/l conversions preserve dimension, never density", () => {
  for (const [small, large] of [["g", "kg"], ["ml", "l"]] as const) { const p = fixture(); p.items[0] = { ...item, measure: "physical", quantity: 3, size: 500, unit: small }; Object.assign(p.prices[0], { size: 750, unit: small, price: 3 }); Object.assign(p.prices[1], { size: 1, unit: large, price: 5 }); const c = commonQuantityComparison(p, day); assert.equal(c.count, 1); assert.equal(c.stores.find(s => s.group.name === "Walmart")!.amount, 6); }
  const p = fixture(); p.items[0].unit = "kg"; p.prices[0].unit = "l"; p.prices[1].unit = "l"; assert.equal(commonQuantityComparison(p, day).count, 0);
});
test("Common basket: uses require stated capacities; no unknown dose or pack quantity inferred", () => {
  const p = fixture(); p.items[0] = { ...item, measure: "uses", quantity: 7, size: null, unit: null, countUnit: "charges" }; p.prices[0].usesPerPack = 25; p.prices[1].usesPerPack = 50;
  const c = commonQuantityComparison(p, day); assert.equal(c.count, 1); assert.equal(c.stores.find(s => s.group.name === "Walmart")!.lines[0].packs, 1);
  delete p.prices[0].usesPerPack; delete p.prices[1].usesPerPack; assert.equal(commonQuantityComparison(p, day).count, 0);
  p.items[0] = { ...item, size: null }; assert.equal(commonQuantityComparison(p, day).count, 0);
});
test("Common basket: dated unavailable, foreign, unknown-mode, estimated and inferred observations stay excluded", () => {
  for (const patch of [{ available: "no" }, { currency: "USD" }, { mode: "unknown" }, { evidence: { ...evidence, until: "2000-01-01" } }, { matchNote: "Format non confirmé" }, { matchNote: "Prix de barquette estimé" }] as Partial<GroceryPrice>[]) { const p = fixture(); p.prices.forEach(q => Object.assign(q, patch)); assert.equal(commonQuantityComparison(p, day).count, 0); }
});
test("Common basket: actual current-basket override and provisional quantity stay visible without mutating usual need", () => {
  const p = fixture(); p.items[0].basketQuantity = 1; p.items[0].provisional = true; const c = commonQuantityComparison(p, day); assert.equal(c.stores.find(s => s.group.name === "Walmart")!.amount, 3); assert.equal(p.items[0].quantity, 2); assert.equal(c.stores.find(s => s.group.name === "Walmart")!.lines[0].item.provisional, true);
});
test("Common basket: zero and singleton do not fabricate percentage, tiny nonzero gaps remain positive", () => {
  const p = fixture(); p.prices[0].price = 0; const c = commonQuantityComparison(p, day); assert.equal(c.stores.find(s => s.group.name === "Superstore")!.percent, null); assert.equal(c.stores.find(s => s.group.name === "Walmart")!.gap, "Montant nul");
  p.prices.pop(); assert.equal(commonQuantityComparison(p, day).stores.find(s => s.group.name === "Walmart")!.gap, "Seul montant");
  p.prices.push({ ...p.prices[0], id: "near", retailerId: "r1", price: 3.000001 }); p.prices[0].price = 3; assert.equal(commonQuantityComparison(p, day).stores.find(s => s.group.name === "Superstore")!.gap, "+<0,1 %");
});
