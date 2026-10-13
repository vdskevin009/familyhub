import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyPlan, groceryItemLimit, validatePlan } from "../apps/worker/dist/grocery-planning.js";
import { GroceryPlanningStore } from "../apps/worker/dist/grocery-planning-store.js";

/** Arbitrary synthetic counts and identities; no household input. */
function fixture(count) {
  const evidence = { title: "Synthetic reviewed source", url: "https://example.com/fixture", date: "2026-10-13", until: null };
  const items = Array.from({ length: count }, (_, n) => ({ id: "synthetic_" + n, name: "Synthetic article " + n, quantity: n % 3 ? 2 : null, size: 500, unit: "g", preference: "Synthetic manual preference " + n, substitutions: n % 2 === 0, active: n % 4 === 0, origin: "synthetic", cadence: n % 3 ? "month" : "unknown", every: 2, cadenceNote: "Synthetic confirmed note", bucket: n % 2 ? "food" : "household", measure: "physical", countUnit: "", provisional: false, freshness: "pantry", basketQuantity: n % 3 ? 1 : null }));
  const retailers = [{ id: "store", name: "Synthetic retailer", delivery: null, service: null, servicePercent: null, feesTaxPercent: null, minimum: null, freeDeliveryAbove: null, areaConfirmed: true, otherFeesReviewed: false, mode: "store", locality: "Synthetic city", slots: "unknown", enabled: true, membershipWeekly: null, membershipStatus: "unknown", membershipNote: "Synthetic retained terms", evidence }];
  const prices = items.slice(0, 300).map((item, n) => ({ id: "price_" + n, itemId: item.id, retailerId: "store", product: "Synthetic exact product " + n, price: 3.25, size: 500, unit: "g", weighed: false, taxPercent: null, currency: "CAD", available: "unknown", substitution: false, approved: n % 2 === 0, kind: "public", evidence, mode: "store", locality: "Synthetic city", localityConfirmed: true, depositPerPack: null, usesPerPack: null, matchNote: "Synthetic retained review " + n }));
  return { ...emptyPlan(), area: "Synthetic city", areaConfirmed: true, items, retailers, prices };
}
test("Shared schema-1 validation admits legacy, expanded and maximum synthetic plans without altering any fields", () => {
  assert.equal(groceryItemLimit, 300);
  for (const count of [0, 60, 77, 300]) { const plan = fixture(count), before = structuredClone(plan); assert.deepEqual(validatePlan(plan), before); assert.deepEqual(plan, before); }
});
test("Expanded bound retains every validation beyond the old limit and rejects over-limit or orphaned data", () => {
  for (const mutate of [p => p.schema = 2, p => p.items.push({ ...p.items[0], id: "over" }), p => p.prices.push({ ...p.prices[0], id: "over" }), p => p.items[299].id = p.items[0].id, p => p.items[299].cadence = "invented", p => p.items[299].quantity = NaN, p => p.items[299].preference = "x".repeat(501), p => p.prices[299].id = p.prices[0].id, p => p.prices[299].itemId = "missing", p => p.prices[299].retailerId = "missing", p => p.prices[299].price = .001, p => p.prices[299].evidence = { ...p.prices[299].evidence, date: "2026-02-30" }, p => p.retailers = Array.from({ length: 17 }, (_, n) => ({ ...p.retailers[0], id: "store" + n }))]) {
    const plan = fixture(300); mutate(plan); assert.throws(() => validatePlan(plan));
  }
});
test("Legacy plan expands atomically to 300, survives restart and preserves cadences, selections, prices and unrelated bytes", async t => {
  const dir = await mkdtemp(join(tmpdir(), "fh-expanded-plan-")); t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, "groceries"));
  const sentinels = [join(dir, "unrelated.json"), join(dir, "groceries", "purchases.json")];
  for (const path of sentinels) await writeFile(path, "Synthetic unchanged sentinel");
  const store = new GroceryPlanningStore(join(dir, "groceries")), legacy = await store.save({ plan: fixture(60), expectedRevision: "" });
  const expanded = fixture(300); expanded.revision = legacy.revision;
  const saved = await store.save({ plan: expanded, expectedRevision: legacy.revision });
  assert.deepEqual(saved, { ...expanded, revision: saved.revision }); assert.notEqual(saved.revision, legacy.revision);
  assert.deepEqual(saved.items.slice(0, 60), legacy.items); assert.deepEqual(saved.prices.slice(0, 60), legacy.prices);
  assert.deepEqual(await new GroceryPlanningStore(join(dir, "groceries")).read(), saved);
  const path = join(dir, "groceries", "planning.json"), bytes = await readFile(path);
  await assert.rejects(store.save({ plan: expanded, expectedRevision: legacy.revision }), /changé/);
  await assert.rejects(store.save({ plan: fixture(301), expectedRevision: saved.revision }), /Limite/);
  const duplicate = structuredClone(saved); duplicate.items[299].id = duplicate.items[0].id;
  await assert.rejects(store.save({ plan: duplicate, expectedRevision: saved.revision }), /dupliqués/);
  assert.deepEqual(await readFile(path), bytes);
  for (const sentinel of sentinels) assert.equal(await readFile(sentinel, "utf8"), "Synthetic unchanged sentinel");
});
