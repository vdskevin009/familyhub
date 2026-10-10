import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyPlan, validatePlan, compareBaskets, offerQuantity, publicSourceUrl } from "../apps/worker/dist/grocery-planning.js";
import { GroceryPlanningStore } from "../apps/worker/dist/grocery-planning-store.js";
import { groceryResearchQuery, groceryResearchPrompt, validatePublicGroceryResult } from "../apps/worker/dist/grocery-research.js";
const now = "2026-10-10", evidence = { title: "Synthetic verified catalogue", url: "https://example.com/catalogue", date: now, until: "2026-10-17" };
export function planningFixture() {
  const items = ["oats", "milk"].map(id => ({ id, name: `Synthetic ${id}`, quantity: 1, size: 1, unit: id === "oats" ? "kg" : "l", preference: "Synthetic exact variant", substitutions: false, active: true, origin: "" }));
  const retailers = ["a", "b"].map(id => ({ id, name: `Synthetic store ${id}`, delivery: 1, service: 0, servicePercent: 0, feesTaxPercent: 0, minimum: 0, freeDeliveryAbove: null, areaConfirmed: true, otherFeesReviewed: true, evidence }));
  const prices = [["oa", "oats", "a", 5, "kg"], ["ob", "oats", "b", 2, "kg"], ["ma", "milk", "a", 2, "l"], ["mb", "milk", "b", 5, "l"]].map(([id, itemId, retailerId, price, unit]) => ({ id, itemId, retailerId, product: `Synthetic exact ${itemId}`, price, size: 1, unit, weighed: false, taxPercent: 0, currency: "CAD", available: "yes", substitution: false, approved: true, kind: "public", evidence }));
  return { ...emptyPlan(), area: "Synthetic city", areaConfirmed: true, items, retailers, prices };
}
test("whole versus split prices include every order's delivery and optional tip", () => {
  const p = planningFixture(), r = compareBaskets(p, now); assert.equal(r.whole[0].total, 800); assert.equal(r.split[0].total, 600); assert.equal(r.best.total, 600);
  p.tipPerOrder = 3; const tipped = compareBaskets(p, now); assert.equal(tipped.split[0].total, 1200); assert.equal(tipped.best.total, 1100); assert.equal(tipped.best.split, false);
});
test("pack sizes round up; compatible mass and volume normalize, weighted goods stay proportional", () => {
  const p = planningFixture(), item = { ...p.items[0], quantity: 2, size: 400, unit: "g" }, offer = { ...p.prices[0], size: 500, unit: "g" };
  assert.equal(offerQuantity(item, offer), 2); assert.equal(offerQuantity(item, { ...offer, weighed: true }), 1.6);
  assert.equal(offerQuantity(item, { ...offer, unit: "ml" }), null); assert.equal(offerQuantity({ ...item, quantity: null }, offer), null);
  assert.equal(offerQuantity({ ...item, quantity: .000001, size: .000001 }, offer), 1);
  assert.equal(offerQuantity({ ...item, quantity: 1.0000000001, size: 500 }, offer), 2);
});
test("missing prices, quantity, mandatory fees, taxes and minimums never create a cheapest basket", () => {
  for (const edit of [p => p.prices = p.prices.filter(o => o.itemId !== "milk"), p => p.items[0].quantity = null, p => p.retailers.forEach(r => r.delivery = null), p => p.prices.forEach(o => o.taxPercent = null), p => p.retailers.forEach(r => r.minimum = null), p => p.retailers.forEach(r => r.otherFeesReviewed = false)]) {
    const p = planningFixture(); edit(p); const result = compareBaskets(p, now); assert.equal(result.best, null); assert.ok(result.whole.every(b => b.total === null));
  }
});
test("unknown availability, expiry, home coverage, unmet minimum and historical receipts are conditional", () => {
  for (const edit of [p => p.prices.forEach(o => o.available = "unknown"), p => p.prices.forEach(o => o.evidence = { ...evidence, until: null }), p => p.prices.forEach(o => o.evidence = { ...evidence, until: "2026-10-09" }), p => p.areaConfirmed = false, p => p.retailers.forEach(r => r.areaConfirmed = false), p => p.retailers.forEach(r => r.minimum = 10), p => p.prices.forEach(o => o.kind = "receipt")]) {
    const p = planningFixture(); edit(p); const result = compareBaskets(p, now); assert.equal(result.best, null); assert.ok(result.whole.every(b => b.missing.length));
  }
});
test("approved substitutions, currency and product review gate comparison", () => {
  const p = planningFixture(); p.prices.forEach(o => { if (o.itemId === "milk") o.substitution = true; }); assert.equal(compareBaskets(p, now).best, null);
  p.items[1].substitutions = true; assert.equal(compareBaskets(p, now).best.total, 600);
  p.prices.forEach(o => o.approved = false); assert.equal(compareBaskets(p, now).coverage, 0);
  p.prices.forEach(o => { o.approved = true; o.currency = "USD"; }); assert.equal(compareBaskets(p, now).coverage, 0);
});
test("nonlinear delivery thresholds retain a pricier pack when the complete basket is lower", () => {
  const p = planningFixture(); p.items = [p.items[0]]; p.retailers = [p.retailers[0]]; p.retailers[0].delivery = 10; p.retailers[0].freeDeliveryAbove = 6;
  p.prices = [{ ...p.prices[0], price: 5 }, { ...p.prices[0], id: "large", price: 6, size: 2 }];
  const r = compareBaskets(p, now); assert.equal(r.best.total, 600); assert.equal(r.best.lines[0].priceId, "large");
});
test("flat and percent service, line taxes, fee taxes and cents rounding remain separate", () => {
  const p = planningFixture(); p.items = [p.items[0]]; p.retailers = [p.retailers[0]]; p.prices = [p.prices[0]]; p.prices[0].price = 3.33; p.prices[0].taxPercent = 5;
  Object.assign(p.retailers[0], { delivery: 1.23, service: .5, servicePercent: 5, feesTaxPercent: 5 }); p.tipPerOrder = 2;
  const o = compareBaskets(p, now).best.orders[0]; assert.deepEqual([o.subtotal, o.tax, o.delivery, o.service, o.feesTax, o.tip, o.total], [333, 17, 123, 67, 10, 200, 750]);
});
test("bounded search refuses to announce global minimum", () => {
  const p = planningFixture(); p.items = Array.from({ length: 14 }, (_, n) => ({ ...p.items[0], id: `i${n}` })); p.prices = p.items.flatMap(i => ["a", "b"].map(retailerId => ({ ...p.prices[0], id: `${i.id}_${retailerId}`, itemId: i.id, retailerId })));
  const r = compareBaskets(p, now); assert.equal(r.truncated, true); assert.equal(r.examined, 5000); assert.equal(r.best, null);
});
test("extreme sizes and overflow cannot create finite-looking free or cheapest baskets", () => {
  const p = planningFixture(); p.prices.forEach(o => o.size = 1e-300); assert.throws(() => validatePlan(p)); assert.equal(compareBaskets(p, now).best, null);
  p.prices.forEach(o => { o.size = .000001; o.price = 1_000_000; }); assert.equal(compareBaskets(p, now).best, null);
});
test("validation rejects missing sources, invalid dates, references, nonfinite values and unsafe URLs", () => {
  assert.deepEqual(validatePlan(planningFixture()), planningFixture());
  for (const edit of [p => p.prices[0].price = NaN, p => p.prices[0].price = .001, p => p.prices[0].evidence = { ...evidence, date: "2026-02-30" }, p => p.prices[0].itemId = "missing", p => p.prices[0].evidence = { ...evidence, title: "" }, p => p.items.push(p.items[0]), p => p.area = ""]) { const p = planningFixture(); edit(p); assert.throws(() => validatePlan(p)); }
  for (const url of ["javascript:alert(1)", "https://user:pass@example.com", "https://127.0.0.1/x", "https://0x7f000001/x", "https://192.168.1.1", "https://host.local", "https://[::1]/"]) assert.throws(() => publicSourceUrl(url));
});
test("planning store restarts, serializes writes, rejects stale revisions and preserves damaged/unrelated files", async t => {
  const dir = await mkdtemp(join(tmpdir(), "fh-grocery-plan-")); t.after(() => rm(dir, { recursive: true, force: true })); await mkdir(join(dir, "groceries"));
  const sentinel = "synthetic family ledger"; await writeFile(join(dir, "ledger.json"), sentinel);
  const store = new GroceryPlanningStore(join(dir, "groceries")), p = planningFixture(); const saved = await store.save({ plan: p, expectedRevision: "" }); assert.ok(saved.revision);
  const writes = await Promise.allSettled([store.save({ plan: saved, expectedRevision: saved.revision }), store.save({ plan: saved, expectedRevision: saved.revision })]); assert.equal(writes.filter(w => w.status === "fulfilled").length, 1);
  assert.equal((await new GroceryPlanningStore(join(dir, "groceries")).read()).items.length, 2); assert.equal(await readFile(join(dir, "ledger.json"), "utf8"), sentinel);
  const path = join(dir, "groceries", "planning.json"); await writeFile(path, "damaged"); await assert.rejects(store.save({ plan: p, expectedRevision: "" }), /préservé/); assert.equal(await readFile(path, "utf8"), "damaged");
});
test("public research only accepts an explicitly reviewed generic product and coarse home area", () => {
  const query = groceryResearchQuery({ product: "rolled oats", area: "Montréal", confirmed: true, quantity: 99, receipt: "PRIVATE SENTINEL" });
  const prompt = groceryResearchPrompt(query, now); assert.ok(prompt.includes("rolled oats")); assert.ok(!prompt.includes("PRIVATE SENTINEL")); assert.ok(!prompt.includes("99"));
  for (const v of [{ ...query, confirmed: false }, { ...query, confirmed: true, area: "123 Main Street" }, { ...query, confirmed: true, area: "H2X 1Y4" }]) assert.throws(() => groceryResearchQuery(v));
  assert.equal(groceryResearchQuery({ product: "oats", area: "H2X", confirmed: true }).area, "H2X");
});
test("public results fail closed on unsourced prices, future observation dates and invalid precision", () => {
  const result = { summary: "Synthetic catalogue", prices: [{ retailer: "Synthetic", product: "Oats", price: 3.99, size: 500, unit: "g", currency: "CAD", date: now, until: null, url: evidence.url, notes: "Availability unknown" }] };
  assert.equal(validatePublicGroceryResult(structuredClone(result), now).prices.length, 1);
  for (const edit of [r => r.prices[0].url = "", r => r.prices[0].date = "2026-10-11", r => r.prices[0].price = 3.999, r => r.prices[0].until = "2026-02-30"]) { const r = structuredClone(result); edit(r); assert.throws(() => validatePublicGroceryResult(r, now)); }
});
