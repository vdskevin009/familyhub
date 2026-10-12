import test from "node:test";
import assert from "node:assert/strict";
import { emptyPlan, type GroceryPrice, type ShoppingItem } from "../../worker/src/grocery-planning";
import { articleUnitComparison, formatUnitRate, observedUnitRate, unitPercentLabel } from "../src/grocery-unit-comparison";
import { storeGroups } from "../src/grocery-comparison";

const date = new Date().toISOString().slice(0, 10);
const evidence = { title: "Synthetic source", url: "https://example.com/fixture", date, until: "2099-12-31" };
const item = (patch: Partial<ShoppingItem> = {}): ShoppingItem => ({ id: "i", name: "Synthetic eggs", quantity: 12, size: 1, unit: "each", countUnit: "œufs", preference: "", substitutions: false, active: true, origin: "synthetic", measure: "physical", ...patch });
function fixture(offers: Partial<GroceryPrice>[], i = item()) {
  const names = ["Fresh St. Market", "Walmart", "Costco", "Superstore"];
  const p = emptyPlan(); p.items = [i];
  p.retailers = offers.map((o, n) => ({ id: "r" + n, name: names[n] ?? "Synthetic store " + n, delivery: null, service: null, servicePercent: null, feesTaxPercent: null, minimum: null, freeDeliveryAbove: null, areaConfirmed: false, otherFeesReviewed: false, mode: n === 2 ? "delivery" as const : "pickup" as const, locality: "Synthetic city", evidence }));
  p.prices = offers.map((o, n) => ({ id: "p" + n, itemId: "i", retailerId: "r" + n, product: "Synthetic variant " + n, price: 4, size: 12, unit: "each", weighed: false, taxPercent: null, currency: "CAD", available: "unknown", approved: false, substitution: true, kind: "public", mode: p.retailers[n].mode, localityConfirmed: false, evidence, ...o }));
  return p;
}
const compare = (p: ReturnType<typeof fixture>) => articleUnitComparison(p, p.items[0], storeGroups(p));

test("Unit comparison sorts egg rate, not package price; percentages before rounding and no mutation", () => {
  const p = fixture([{ price: 6, size: 12 }, { price: 9, size: 30 }, { price: 10, size: 20 }, { price: 4, size: 10 }]), before = structuredClone(p);
  const c = compare(p); assert.deepEqual(c.rows.map(r => r.group.name), ["Walmart", "Superstore", "Fresh St. Market", "Costco"]);
  assert.equal(c.minimum, .3); assert.equal(c.rows[0].offers[0].gap, "Plus bas observé · 0 %");
  assert.ok(Math.abs(c.rows[1].offers[0].percent! - 100 / 3) < 1e-10);
  assert.equal(c.rows[1].offers[0].gap, "+33,3 %"); assert.equal(c.rows[0].offers[0].rate?.label, "œuf");
  assert.deepEqual(p, before); assert.equal(p.prices.filter(p => p.approved).length, 0);
});
test("Unit comparison converts g/kg and ml/l without crossing mass and volume", () => {
  const p = fixture([{ price: 4, size: 500, unit: "g" }, { price: 6, size: 1, unit: "kg" }, { price: 5, size: 1, unit: "l" }], item({ unit: "kg", countUnit: "", quantity: null }));
  const c = compare(p); assert.equal(c.basis, "kg"); assert.equal(c.minimum, 6);
  assert.equal(c.rows[0].group.name, "Walmart"); assert.equal(c.rows.find(r => r.group.name === "Costco")!.offers[0].reason, "Unité différente");
  assert.equal(c.rows.find(r => r.group.name === "Costco")!.offers[0].percent, null);
  const liquids = fixture([{ price: 3, size: 500, unit: "ml" }, { price: 4, size: 1, unit: "l" }], item({ unit: "l" }));
  assert.equal(compare(liquids).minimum, 4); assert.equal(compare(liquids).rows[1].offers[0].percent, 50);
});
test("Unit comparison keeps known slices separate from unproven counts in a weight format", () => {
  const p = fixture([{ price: 6, size: 12 }, { price: 9, size: 24 }, { price: 3, size: 240, unit: "g" }], item({ countUnit: "tranches" }));
  const c = compare(p); assert.equal(c.basis, "each"); assert.equal(c.rows[0].offers[0].rate?.label, "tranche");
  assert.equal(c.rows.find(r => r.group.name === "Costco")!.offers[0].gap, "Non comparable");
});
test("Unit comparison only calculates load rates from a stated capacity", () => {
  const p = fixture([{ price: 10, size: 1, unit: "l", usesPerPack: 25 }, { price: 20, size: 2, unit: "l", usesPerPack: 100 }, { price: 5, size: 1, unit: "l" }], item({ measure: "uses", countUnit: "charges", size: null, unit: null }));
  const c = compare(p); assert.equal(c.basis, "uses"); assert.equal(c.rows[0].offers[0].rate?.label, "charge (étiquette)");
  assert.equal(c.minimum, .2); assert.equal(c.rows[1].offers[0].percent, 100);
  assert.equal(c.rows.find(r => r.group.name === "Costco")!.offers[0].percent, null);
  assert.equal(observedUnitRate(p.items[0], { ...p.prices[0], usesPerPack: 0 }), null);
});
test("Unit comparison can use physical gel volume with unknown dose, never kg/l density", () => {
  const p = fixture([{ price: 9, size: 1.5, unit: "l" }, { price: 8, size: 2, unit: "l" }, { price: 4, size: 3, unit: "kg" }], item({ measure: "uses", countUnit: "cycles", size: null, unit: null }));
  const c = compare(p); assert.equal(c.basis, "l"); assert.equal(c.minimum, 4);
  assert.equal(c.rows.find(r => r.group.name === "Costco")!.offers[0].percent, null);
});
test("Unit comparison leaves expired, receipt, unavailable, foreign, disabled and unknown-mode prices neutral", () => {
  for (const patch of [{ currency: "USD" }, { mode: "unknown" }, { available: "no" }, { kind: "receipt" }, { evidence: { ...evidence, date: "2000-01-01", until: "2000-01-02" } }, { evidence: { ...evidence, date: "2099-01-01" } }] as Partial<GroceryPrice>[]) {
    const p = fixture([{ price: 1, ...patch }, { price: 5 }, { price: 6 }]);
    const c = compare(p); assert.equal(c.rows[0].group.name, "Walmart"); assert.equal(c.rows.find(r => r.group.name === "Fresh St. Market")!.offers[0].percent, null);
  }
  const p = fixture([{ price: 1 }, { price: 5 }, { price: 6 }]); p.retailers[0].enabled = false; assert.equal(compare(p).rows[0].group.name, "Walmart");
});
test("Unit comparison never ranks inferred format, estimated pack price or invalid numbers", () => {
  for (const patch of [{ matchNote: "Format non confirmé" }, { matchNote: "Prix de barquette estimé" }, { size: 0 }, { price: NaN }, { price: Infinity }, { price: -1 }]) {
    const p = fixture([{ price: 1, ...patch }, { price: 5 }, { price: 6 }]); const c = compare(p);
    assert.equal(c.rows[0].group.name, "Walmart"); assert.equal(c.rows.find(r => r.group.name === "Fresh St. Market")!.offers[0].percent, null);
  }
});
test("Unit comparison uses exact rates for ties and retains stable store order", () => {
  const p = fixture([{ price: 3.6, size: 12 }, { price: 6, size: 20 }, { price: 12, size: 30 }]);
  const c = compare(p); assert.deepEqual(c.rows.slice(0, 2).map(r => r.group.name), ["Fresh St. Market", "Walmart"]);
  assert.ok(c.rows.slice(0, 2).every(r => r.offers[0].gap === "Ex æquo · 0 %"));
  assert.equal(c.rows[2].offers[0].gap, "+33,3 %");
});
test("Unit comparison never displays a tiny positive gap as zero", () => {
  const p = fixture([{ price: 20, size: 1000 }, { price: 20.01, size: 1000 }]);
  assert.equal(compare(p).rows[1].offers[0].gap, "+<0,1 %");
  assert.equal(unitPercentLabel(.04), "+<0,1 %");
  assert.equal(unitPercentLabel(.09999999999999), "+0,1 %");
  assert.equal(formatUnitRate({ amount: .000001, basis: "each", label: "unité" }, "CAD"), "<0,0001 CAD/unité");
});
test("Unit comparison handles an actual zero minimum without division or a false percentage", () => {
  const p = fixture([{ price: 0 }, { price: 4 }]); const c = compare(p);
  assert.equal(c.rows[0].offers[0].gap, "Prix nul observé"); assert.equal(c.rows[0].offers[0].percent, null);
  assert.equal(c.rows[1].offers[0].gap, "Écart non calculable"); assert.equal(c.rows[1].offers[0].percent, null);
});
test("Unit comparison preserves missing stores and singleton without competitive claim", () => {
  const p = fixture([{ price: 4 }]); const c = compare(p);
  assert.equal(c.rows.length, 4); assert.equal(c.rows[0].offers[0].gap, "Seul prix comparable"); assert.equal(c.rows[0].offers[0].percent, null);
  assert.equal(c.rows.filter(r => !r.offers.length).length, 3);
  const empty = compare(fixture([])); assert.equal(empty.minimum, null); assert.equal(empty.rows.length, 4);
});
test("Unit comparison sorts alternative packs but keeps their price, source, mode and quality", () => {
  const p = fixture([{ price: 6 }, { price: 8 }]); p.prices.push({ ...p.prices[1], id: "alternative", price: 12, size: 36 });
  const before = structuredClone(p), c = compare(p);
  assert.equal(c.rows[0].group.name, "Walmart"); assert.equal(c.rows[0].offers[0].p.id, "alternative");
  assert.equal(c.rows[0].offers[0].p.price, 12); assert.equal(c.rows[0].offers[0].p.mode, "pickup"); assert.equal(c.rows[0].offers[0].p.substitution, true);
  assert.deepEqual(p, before);
});
