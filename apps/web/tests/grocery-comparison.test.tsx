import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { compareBaskets, emptyPlan, type GroceryPlan, type GroceryPrice, type GroceryRetailer, type ShoppingItem } from "../../worker/src/grocery-planning";
import { currentPrices, equivalentCost, formatLabel, observedSummary, priceState, quantityReason, shortProduct, storeGroups, unitPrice } from "../src/grocery-comparison";
import GroceryComparison from "../src/views/GroceryComparison";

const today = new Date().toISOString().slice(0, 10);
const evidence = { title: "Synthetic catalogue", url: "https://example.com/catalogue", date: today, until: "2099-12-31" };
const item = (patch: Partial<ShoppingItem> = {}): ShoppingItem => ({ id: "i", name: "Synthetic muffins", quantity: 10.5, size: 1, unit: "each", preference: "", substitutions: true, active: true, origin: "synthetic", measure: "physical", ...patch });
const retailer = (patch: Partial<GroceryRetailer> = {}): GroceryRetailer => ({ id: "r", name: "Walmart", delivery: 0, service: 0, servicePercent: 0, feesTaxPercent: 0, minimum: 0, freeDeliveryAbove: null, areaConfirmed: true, otherFeesReviewed: true, mode: "pickup", locality: "Synthetic city", slots: "yes", membershipStatus: "none", membershipWeekly: 0, evidence, ...patch });
const price = (patch: Partial<GroceryPrice> = {}): GroceryPrice => ({ id: "p", itemId: "i", retailerId: "r", product: "Synthetic exact muffins", price: 2.5, size: 6, unit: "each", weighed: false, taxPercent: 0, depositPerPack: 0, currency: "CAD", available: "yes", substitution: false, approved: false, kind: "public", mode: "pickup", locality: "Synthetic city", localityConfirmed: false, evidence, ...patch });
function plan(i = item(), r = retailer(), prices = [price()]): GroceryPlan { return { ...emptyPlan(), area: "Synthetic city", areaConfirmed: true, items: [i], retailers: [r], prices }; }

test("Courses presentation: rounded purchase and proportional need remain distinct, unapproved", () => {
  const p = plan(), original = structuredClone(p), s = observedSummary(p, p.retailers[0]);
  assert.equal(s.subtotal, 500); assert.equal(equivalentCost(p.items[0], p.prices[0]), 4.375);
  assert.equal(s.known, 1); assert.equal(s.priced, 1); assert.equal(compareBaskets(p).best, null);
  assert.deepEqual(p, original);
});
test("Courses presentation: unknown usual pack, weight and dose are not converted", () => {
  for (const i of [item({ quantity: null }), item({ measure: "pack", size: null, unit: null }), item({ measure: "uses", quantity: 7 }), item({ unit: "kg" })]) {
    const p = plan(i); assert.equal(observedSummary(p, p.retailers[0]).subtotal, null); assert.ok(quantityReason(i, p.prices[0])); assert.equal(equivalentCost(i, p.prices[0]), null);
  }
  assert.equal(observedSummary(plan(item({ measure: "pack", size: 6 })), retailer()).subtotal, 2750);
  assert.match(quantityReason(item({ measure: "pack", size: 12 }), price()), /différents/);
});
test("Courses presentation: uncertain format blocks unit and basket costs", () => {
  const q = price({ matchNote: "Format non confirmé; inferred capacity must not be used" }), p = plan(item(), retailer(), [q]);
  assert.equal(formatLabel(q, p.items[0]), "Format à vérifier");
  assert.match(unitPrice(q), /taille non confirmée/); assert.equal(observedSummary(p, p.retailers[0]).subtotal, null);
  assert.equal(equivalentCost(p.items[0], q), null);
});
test("Courses presentation: modes, currency, estimates and ambiguous alternatives cannot inflate subtotal", () => {
  for (const q of [price({ mode: "delivery" }), price({ currency: "USD" }), price({ matchNote: "Prix de barquette estimé" })]) {
    const p = plan(item(), retailer(), [q]); assert.equal(observedSummary(p, p.retailers[0]).subtotal, null);
  }
  const p = plan(item(), retailer(), [price(), price({ id: "other", size: 24 })]); assert.equal(observedSummary(p, p.retailers[0]).subtotal, null);
  assert.match(observedSummary(p, p.retailers[0]).missing[0].reason, /Plusieurs références/);
});
test("Courses presentation: receipt, expired and future observations retain honest status", () => {
  for (const q of [price({ kind: "receipt" }), price({ evidence: { ...evidence, date: "2000-01-01", until: "2000-01-02" } }), price({ evidence: { ...evidence, date: "2099-01-01" } })]) {
    const p = plan(item(), retailer(), [q]); assert.equal(observedSummary(p, p.retailers[0]).known, 0); assert.equal(observedSummary(p, p.retailers[0]).subtotal, null);
    assert.notEqual(priceState(q, p.retailers[0]), "Revu");
  }
  const p = plan(item(), retailer(), [price(), price({ id: "old", evidence: { ...evidence, date: "2000-01-01", until: null } })]);
  assert.deepEqual(currentPrices(p, p.items[0], p.retailers[0]).map(x => x.id), ["p"]);
});
test("Courses presentation: physical and label unit prices and literal brand", () => {
  assert.equal(priceState(price({ matchNote: "Prix de barquette estimé" }), retailer()), "Prix de paquet estimé");
  assert.equal(priceState(price({ matchNote: "Taux BASE 17.58/kg avant remise par paquet" }), retailer()), "Avant remise par paquet");
  assert.equal(unitPrice(price({ price: 3, size: 500, unit: "g" })), "6 CAD/kg");
  assert.equal(unitPrice(price({ price: 10, size: 946, unit: "ml", usesPerPack: 25 })), "0.4 CAD/utilisation (étiquette)");
  assert.equal(shortProduct("Great Value Plain English Muffins"), "Great Value");
  assert.equal(shortProduct("Unidentified reference"), "Unidentified reference");
});
test("Courses presentation: four stores, missing dash, article-first and collapsed sources without mutation", () => {
  const p = plan(), before = structuredClone(p), html = renderToStaticMarkup(createElement(GroceryComparison, { plan: p, comparison: compareBaskets(p) }));
  assert.equal(storeGroups(p).length, 4); for (const name of ["Fresh St.", "Walmart", "Costco", "Superstore", "Prix par article", "Sous-total partiel observé", "Prix manquant"]) assert.ok(html.includes(name));
  assert.ok(!html.includes("Panier complet estimé")); assert.ok(!html.includes(" open="));
  assert.ok(html.indexOf("Info prix Synthetic muffins") < html.indexOf("example.com/catalogue", html.indexOf("Info prix Synthetic muffins")));
  assert.deepEqual(p, before);
});
test("Courses presentation: complete reviewed basket and conditional availability are distinct", () => {
  const p = plan(item(), retailer(), [price({ approved: true, localityConfirmed: true })]);
  let html = renderToStaticMarkup(createElement(GroceryComparison, { plan: p, comparison: compareBaskets(p) })); assert.ok(html.includes("Panier complet estimé"));
  p.prices[0].available = "unknown"; html = renderToStaticMarkup(createElement(GroceryComparison, { plan: p, comparison: compareBaskets(p) })); assert.ok(html.includes("Panier complet conditionnel")); assert.ok(!html.includes("Estimation la plus basse"));
});
