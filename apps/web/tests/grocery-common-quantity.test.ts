import test from "node:test";
import assert from "node:assert/strict";
import { emptyPlan, type GroceryPrice, type ShoppingItem } from "../../worker/src/grocery-planning";
import { retailerTemplate } from "../../worker/src/grocery-weekly";
import { adjustedMoney, adjustedNumber, commonQuantityComparison } from "../src/grocery-common-quantity";
import { articleComparisonCoverage } from "../src/grocery-unit-comparison";
import { storeGroups } from "../src/grocery-comparison";
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
  delete p.prices[0].usesPerPack; delete p.prices[1].usesPerPack; const physical = commonQuantityComparison(p, day); assert.equal(physical.count, 1); assert.equal(physical.referenceCount, 1); assert.equal(physical.stores[0].lines[0].offer.rate!.basis, "each"); assert.equal(physical.stores[0].lines[0].quantity, 1);
  p.items[0] = { ...item, size: null }; assert.equal(commonQuantityComparison(p, day).referenceCount, 1);
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
test("Common basket: small positive quantity or proportional money never displays as actual zero", () => {
  assert.equal(adjustedNumber(.000001), "<0,0001"); assert.equal(adjustedMoney(.001, "CAD"), "<0,01 CAD");
  assert.equal(adjustedNumber(0), "0"); assert.equal(adjustedMoney(0, "CAD"), "0,00 CAD");
});
test("Common basket: normalized ascending amounts, unknowns last and equal amounts alphabetical", () => {
  const p = fixture(); p.prices[0].price = 8;
  let c = commonQuantityComparison(p, day);
  assert.deepEqual(c.stores.map(s => s.group.name), ["Superstore", "Walmart", "Costco", "Fresh St. Market"]);
  assert.equal(c.stores[0].percent, 0); assert.ok(c.stores[1].percent! > 0);
  p.prices[0].price = 3; Object.assign(p.prices[1], { price: 3, size: 12 });
  c = commonQuantityComparison(p, day);
  assert.deepEqual(c.stores.slice(0, 2).map(s => [s.group.name, s.percent]), [["Superstore", 0], ["Walmart", 0]]);
  assert.ok(c.stores.slice(0, 2).every(s => s.gap === "0 % ex æquo"));
  p.retailers.reverse(); p.prices.reverse();
  assert.deepEqual(commonQuantityComparison(p, day), c);
});
test("Common basket: disabled store is unranked, shared IDs and quantities stay identical", () => {
  const p = fixture(); p.items.push({ ...item, id: "second" });
  p.prices.push(...p.prices.map(o => ({ ...o, id: `${o.id}-second`, itemId: "second" })));
  const c = commonQuantityComparison(p, day);
  assert.deepEqual(c.stores.filter(s => s.amount !== null).map(s => s.lines.map(l => [l.item.id, l.quantity])), [[["i", 24], ["second", 24]], [["i", 24], ["second", 24]]]);
  p.retailers[0].enabled = false;
  const disabled = commonQuantityComparison(p, day).stores.find(s => s.group.name === "Walmart")!;
  assert.equal(disabled.amount, null); assert.equal(disabled.percent, null);
});
test("Common basket: nonfinite relative gap is unknown, never a percentage", () => {
  const p = fixture(); p.prices[0].price = 1e-310;
  const higher = commonQuantityComparison(p, day).stores.find(s => s.group.name === "Superstore")!;
  assert.equal(higher.percent, null); assert.equal(higher.gap, "Écart inconnu");
});

test("Coverage: unknown quantities keep competing unit prices and one store's variants do not inflate coverage", () => {
  const p = fixture(); p.items[0].quantity = null;
  assert.deepEqual(articleComparisonCoverage(p, storeGroups(p), day), { count: 1, total: 1 });
  const common = commonQuantityComparison(p, day);
  assert.equal(common.count, 1); assert.equal(common.referenceCount, 1); assert.equal(common.stores[0].lines[0].quantity, 1); assert.equal(p.items[0].quantity, null);
  p.prices[1].retailerId = p.prices[0].retailerId;
  assert.equal(articleComparisonCoverage(p, storeGroups(p), day).count, 0);
});
test("Common basket: selected stores expand shared articles without changing quantities or ranking unequal bases", () => {
  const p = fixture();
  p.retailers.push({ ...retailerTemplate("r2", "Costco"), mode: "delivery" });
  p.prices.push({ ...p.prices[0], id: "third", retailerId: "r2", mode: "delivery" });
  p.items.push({ ...item, id: "extra" });
  p.prices.push(...p.prices.slice(0, 2).map(o => ({ ...o, id: `${o.id}-extra`, itemId: "extra" })));
  const before = structuredClone(p);
  assert.equal(commonQuantityComparison(p, day).count, 1);
  const pair = commonQuantityComparison(p, day, ["Walmart", "Superstore"]);
  assert.equal(pair.count, 2); assert.equal(pair.participants, 2);
  assert.deepEqual(pair.stores.map(s => s.lines.map(l => [l.item.id, l.quantity])), [[["i", 24], ["extra", 24]], [["i", 24], ["extra", 24]]]);
  assert.deepEqual(p, before);
  const excluded = commonQuantityComparison(p, day).exclusionDetails.find(e => e.item.id === "extra")!;
  assert.match(excluded.reason, /Costco/);
});
test("Common basket: explicitly chosen unpriced store, empty and singleton selections never claim a competing minimum", () => {
  const p = fixture(); p.retailers.push({ ...retailerTemplate("missing", "Unpriced store"), mode: "pickup" });
  const unpriced = commonQuantityComparison(p, day, ["Walmart", "Unpriced store"]);
  assert.equal(unpriced.participants, 2); assert.equal(unpriced.count, 0);
  assert.ok(unpriced.stores.every(s => s.amount === null && s.percent === null));
  assert.match(unpriced.exclusionDetails[0].reason, /Unpriced store/);
  assert.equal(commonQuantityComparison(p, day, []).count, 0);
  const single = commonQuantityComparison(p, day, ["Walmart"]);
  assert.equal(single.stores[0].gap, "Seul montant"); assert.equal(single.stores[0].percent, null);
});
test("Common basket: unknown pack and dose use a separate common physical reference", () => {
  const p = fixture(); p.items[0].size = null;
  assert.equal(commonQuantityComparison(p, day).referenceCount, 1);
  p.items[0].measure = "uses";
  const c = commonQuantityComparison(p, day, ["Walmart", "Superstore"]);
  assert.equal(c.referenceCount, 1); assert.ok(c.stores.every(s => s.lines[0].quantity === 1 && s.lines[0].label === "unités"));
  assert.equal(p.items[0].quantity, 2); assert.ok(p.prices.every(o => o.usesPerPack === undefined));
});

test("Reference quantities: all fourteen unknown needs share identical quantities at every chosen store, no mutation", () => {
  const p = fixture();
  p.items = Array.from({ length: 14 }, (_, n) => ({ ...item, id: 'need-' + n, quantity: null, size: null, unit: null, measure: "physical" as const }));
  const offers = p.prices;
  p.prices = p.items.flatMap((i, n) => offers.map(o => ({ ...o, id: o.id + '-' + n, itemId: i.id, unit: n % 2 ? "g" as const : "ml" as const, size: 500, price: 2 })));
  const before = structuredClone(p), c = commonQuantityComparison(p, day, ["Walmart", "Superstore"]);
  assert.equal(c.count, 14); assert.equal(c.referenceCount, 14);
  assert.deepEqual(c.stores[0].lines.map(l => [l.item.id, l.quantity, l.label]), c.stores[1].lines.map(l => [l.item.id, l.quantity, l.label]));
  assert.ok(c.stores[0].lines.every(l => l.quantity === 1 && l.reference));
  assert.equal(c.stores[0].amount, 56); assert.deepEqual(p, before);
  p.retailers.push({ ...retailerTemplate("r2", "Costco"), mode: "pickup" });
  const missing = commonQuantityComparison(p, day, ["Walmart", "Costco"]);
  assert.equal(missing.count, 0); assert.ok(missing.stores.every(s => s.amount === null));
});
test("Reference quantities: portions without weights use 1 kg without assigning any weight to each portion", () => {
  const p = fixture(); p.items[0] = { ...item, measure: "physical", quantity: 4, size: 1, unit: "each", countUnit: "poitrines" };
  for (const o of p.prices) Object.assign(o, { size: 1, unit: "kg", price: 10 });
  const before = structuredClone(p), c = commonQuantityComparison(p, day);
  assert.equal(c.referenceCount, 1); assert.ok(c.stores.filter(s => s.amount !== null).every(s => s.lines[0].quantity === 1 && s.lines[0].label === "kg"));
  assert.deepEqual(p, before);
});
test("Reference quantities: explicit unknown basket quantity stays unknown, invalid values do not become reference prices", () => {
  const p = fixture(); p.items[0].basketQuantity = null;
  assert.equal(commonQuantityComparison(p, day).referenceCount, 1); assert.equal(p.items[0].basketQuantity, null);
  for (const q of [0, -1, NaN, Infinity]) { p.items[0].basketQuantity = q; assert.equal(commonQuantityComparison(p, day).count, 0); }
});
test("Dense basket details: nine long-named articles retain exact normalized amounts and distinct whole-pack purchases", () => {
  const p = fixture(), originals = p.prices;
  p.items = Array.from({ length: 9 }, (_, n) => ({ ...item, id: `dense-${n}`, name: `Synthetic long household article ${n + 1} with a descriptive variety and family-sized format`, quantity: n === 8 ? null : 10.5, size: 1, measure: "physical" as const }));
  p.prices = p.items.flatMap((i, n) => originals.map((o, storeIndex) => ({ ...o, id: `${o.id}-${n}`, itemId: i.id, product: `Synthetic full recorded product ${n + 1} with a long manufacturer description that remains available in expanded details`, size: 6, price: 2.5 + n + storeIndex })));
  const before = structuredClone(p), c = commonQuantityComparison(p, day), walmart = c.stores.find(s => s.group.name === "Walmart")!;
  assert.equal(c.count, 9); assert.equal(c.referenceCount, 1);
  assert.deepEqual(walmart.lines.map(l => l.item.name), p.items.map(i => i.name));
  assert.deepEqual(walmart.lines.map(l => l.offer.p.product), p.prices.filter(o => o.retailerId === "r0").map(o => o.product));
  assert.equal(walmart.amount, walmart.lines.reduce((sum, l) => sum + l.normalized, 0));
  assert.equal(adjustedMoney(walmart.lines[0].normalized, "CAD"), "4,38 CAD");
  assert.equal(adjustedMoney(walmart.lines[0].purchase, "CAD"), "5,00 CAD");
  assert.equal(adjustedMoney(walmart.lines[8].normalized, "CAD"), "1,75 CAD");
  assert.equal(adjustedMoney(walmart.lines[8].purchase, "CAD"), "10,50 CAD");
  assert.notEqual(walmart.amount, walmart.lines.reduce((sum, l) => sum + l.purchase, 0));
  for (const store of c.stores.filter(s => s.amount !== null)) assert.deepEqual(store.lines.map(l => [l.item.id, l.quantity, l.reference]), walmart.lines.map(l => [l.item.id, l.quantity, l.reference]));
  assert.deepEqual(p, before);
});
