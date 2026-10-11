import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyPlan, validatePlan, compareBaskets, offerQuantity } from "../apps/worker/dist/grocery-planning.js";
import { deliveryScenarios, cadenceLabel, needLabel } from "../apps/worker/dist/grocery-weekly.js";
import { GroceryPlanningStore } from "../apps/worker/dist/grocery-planning-store.js";
const now = "2026-10-11", evidence = { title: "Synthetic only", url: "https://example.com/source", date: now, until: "2026-10-18" };
function fixture() {
  const items = ["food", "soap", "monthly"].map(id => ({ id, name: `Synthetic ${id}`, quantity: id === "food" ? 21 : 3, size: 1, unit: "each", preference: "exact", substitutions: false, active: id !== "monthly", origin: "", cadence: id === "monthly" ? "month" : "week", every: 1, bucket: id === "soap" ? "household" : "food", measure: "physical", provisional: false }));
  const retailers = ["delivery", "warehouse"].map(id => ({ id, name: `Synthetic ${id}`, mode: id === "delivery" ? "delivery" : "store", locality: "Synthetic city", slots: id === "delivery" ? "yes" : "unknown", enabled: true, delivery: 0, service: 0, servicePercent: 0, feesTaxPercent: 0, minimum: 35, freeDeliveryAbove: null, areaConfirmed: true, otherFeesReviewed: true, membershipWeekly: 2, membershipStatus: "existing", membershipNote: "Synthetic allocation", evidence }));
  const prices = items.flatMap(i => retailers.map(r => ({ id: i.id + "_" + r.id, itemId: i.id, retailerId: r.id, mode: r.mode, locality: r.locality, localityConfirmed: true, depositPerPack: .1, usesPerPack: null, matchNote: "Exact synthetic item reviewed", product: i.name, price: i.id === "food" ? 4 : 6, size: i.id === "food" ? 12 : 1, unit: "each", weighed: false, taxPercent: 0, currency: "CAD", available: "yes", substitution: false, approved: true, kind: "public", evidence })));
  return { ...emptyPlan(), area: "Synthetic city", areaConfirmed: true, items, retailers, prices };
}
test("cadence, budget and quantities survive shared storage restart with unrelated bytes preserved", async t => {
  const dir = await mkdtemp(join(tmpdir(), "fh-weekly-")); t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, "ledger.json"), "synthetic unchanged");
  const p = fixture(); p.items[0].basketQuantity = 12; p.items[1].measure = "uses"; p.prices.filter(o => o.itemId === "soap").forEach(o => o.usesPerPack = 5);
  const saved = await new GroceryPlanningStore(join(dir, "groceries")).save({ plan: p, expectedRevision: "" });
  assert.deepEqual(await new GroceryPlanningStore(join(dir, "groceries")).read(), saved);
  assert.equal(await readFile(join(dir, "ledger.json"), "utf8"), "synthetic unchanged");
  assert.equal(saved.items[2].quantity, 3); assert.equal(saved.items[2].active, false);
});
test("strict new metadata validation rejects invalid modes, flags, cadence, zero/negative quantity and invented capacities", () => {
  assert.deepEqual(validatePlan(fixture()), fixture());
  for (const mutate of [p => p.items[0].cadence = "daily", p => p.items[0].every = 0, p => p.items[0].bucket = "madeup", p => p.items[0].basketQuantity = 0, p => p.items[0].basketQuantity = -1, p => p.items[0].provisional = "yes", p => p.retailers[0].mode = "online", p => p.prices[0].usesPerPack = 0, p => p.prices[0].depositPerPack = .001, p => p.retailers[0].membershipStatus = "none"]) { const p = fixture(); mutate(p); assert.throws(() => validatePlan(p)); }
});
test("habit remains editable independently of current basket; unknown quantities stay unknown", () => {
  const p = fixture(), i = p.items[0], o = p.prices[0];
  assert.equal(offerQuantity(i, o), 2); assert.equal(offerQuantity({ ...i, basketQuantity: 12 }, o), 1); assert.equal(offerQuantity({ ...i, basketQuantity: null }, o), null); assert.equal(i.quantity, 21);
  assert.match(cadenceLabel(p.items[2]), /mois/); assert.match(needLabel({ ...i, quantity: null }), /préciser/);
});
test("pack needs don't invent format sizes; uses require manufacturer-confirmed capacity", () => {
  const p = fixture(), i = { ...p.items[1], measure: "uses", quantity: 7, size: null, unit: null }, o = p.prices[2];
  assert.equal(offerQuantity(i, o), null); assert.equal(offerQuantity(i, { ...o, usesPerPack: 5 }), 2);
  assert.equal(offerQuantity({ ...i, measure: "pack", quantity: 1 }, o), 1);
  assert.match(needLabel(i), /confirmer/);
});
test("warehouse and delivery prices never cross modes; unchecked stores stay excluded", () => {
  const p = fixture(); p.retailers[0].enabled = false; p.prices.filter(o => o.retailerId === "warehouse").forEach(o => o.mode = "delivery");
  const r = compareBaskets(p, now); assert.equal(r.coverage, 0); assert.equal(r.best, null); assert.equal(r.whole.length, 1);
});
test("partial and provisional baskets never win; food, household, deposits and membership remain distinct", () => {
  const p = fixture(); p.retailers.forEach(r => r.minimum = 0); const b = compareBaskets(p, now).best;
  assert.equal(b.foodSubtotal, 800); assert.equal(b.householdSubtotal, 1800); assert.equal(b.orders[0].deposit, 50); assert.equal(b.orders[0].membership, 200); assert.equal(b.total, 2850);
  p.items[0].provisional = true; assert.equal(compareBaskets(p, now).best, null);
  p.prices = p.prices.filter(o => o.itemId !== "soap"); assert.ok(compareBaskets(p, now).whole.every(b => b.total === null && b.coverage === 1));
});
test("new local price, unknown slot, mode, deposit and membership checks fail closed", () => {
  for (const mutate of [p => p.prices.forEach(o => o.localityConfirmed = false), p => p.retailers.forEach(r => { r.mode = "unknown"; p.prices.filter(o => o.retailerId === r.id).forEach(o => o.mode = "unknown"); }), p => p.prices.forEach(o => o.depositPerPack = null), p => p.retailers.forEach(r => r.membershipWeekly = null), p => p.retailers.forEach(r => r.membershipStatus = "proposal")]) { const p = fixture(); p.retailers.forEach(r => r.minimum = 0); mutate(p); assert.equal(compareBaskets(p, now).best, null); }
  const p = fixture(); p.retailers = [p.retailers[0]]; p.prices = p.prices.filter(o => o.retailerId === "delivery"); p.retailers[0].minimum = 0; p.retailers[0].slots = "unknown"; assert.equal(compareBaskets(p, now).best, null);
});
test("adding weekly needs cannot silently certify legacy offers with absent modes/locality/costs", () => {
  const p = fixture(); p.retailers.forEach(r => { delete r.mode; delete r.locality; delete r.membershipWeekly; delete r.membershipStatus; r.minimum = 0; });
  p.prices.forEach(o => { delete o.mode; delete o.locality; delete o.localityConfirmed; delete o.depositPerPack; });
  const r = compareBaskets(p, now); assert.equal(r.best, null); assert.ok(r.whole.every(b => b.total === null));
  assert.ok(r.whole[0].missing.some(s => s.includes("local")));
});
test("freshness proposals exclude monthly items and reveal repeated packs/minimums without order promises", () => {
  const p = fixture(); p.items[2].active = true; const scenarios = deliveryScenarios(p, now)[0].scenarios;
  assert.deepEqual(scenarios.map(s => s.deliveries), [1, 2, 7]); assert.deepEqual(scenarios.map(s => s.count), [2, 2, 2]);
  assert.deepEqual(scenarios.map(s => s.minimumProducts), [3500, 7000, 24500]);
  assert.equal(scenarios[0].knownProducts, 2600); assert.equal(scenarios[0].requiredExtra, 900); assert.equal(scenarios[1].extraPackCost, 600);
  for (const s of scenarios) { assert.equal(s.eligible, false); assert.equal(s.wasteEstimate, null); assert.equal(s.localTopupTotal, null); }
  assert.equal(p.items[2].quantity, 3);
});
