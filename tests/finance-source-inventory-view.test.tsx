import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import FinanceSourceInventory from "../apps/web/src/views/FinanceSourceInventory";
import { validateFinanceSourceInventory } from "../apps/worker/src/finance-source-inventory-model";
// @ts-ignore Synthetic JS fixture is intentionally shared with the Node store tests.
import { inventoryFixture, inventoryNow } from "./finance-source-inventory-fixture.mjs";

test("source balances show collection timestamp, unknown bank date and separate credit dates without totals", () => {
  const html = renderToStaticMarkup(<FinanceSourceInventory snapshot={validateFinanceSourceInventory(inventoryFixture(), inventoryNow)} now={inventoryNow} />);
  assert.match(html, /Non rapproché/); assert.match(html, /Date bancaire non fournie/); assert.match(html, /dateTime="2030-05-01T12:00:00.000Z"/);
  assert.match(html, /dateTime="2030-04-18"/); assert.match(html, /dateTime="2030-04-19"/); assert.match(html, /dateTime="2030-05-09"/);
  assert.match(html, /-123[,.]45/); assert.match(html, /couverture non établie/); assert.match(html, /Aucune ligne renvoyée ne prouve/);
  assert.match(html, /Date prévue déjà passée/); assert.match(html, /ni des dépenses comptabilisées ni des factures confirmées/);
  assert.doesNotMatch(html, /Solde total|Patrimoine total|Collecte ancienne|fsi_[a-f0-9]/);
});
test("null inventory and missing monetary fields never render fake zero; aging does not fill source date", () => {
  const missing = renderToStaticMarkup(<FinanceSourceInventory snapshot={null} />); assert.match(missing, /Inventaire non disponible/); assert.doesNotMatch(missing, /0,00/);
  const f = inventoryFixture(); f.accounts[0].balance = null; f.predictions[0].amount = null;
  const html = renderToStaticMarkup(<FinanceSourceInventory snapshot={validateFinanceSourceInventory(f, inventoryNow)} now={new Date("2030-05-03T12:00:00Z")} />);
  assert.match(html, /Montant non fourni/); assert.match(html, /Collecte ancienne/); assert.doesNotMatch(html, /0,00/);
  assert.match(html, /Récupéré le/); assert.match(html, /<summary>Prévisions récurrentes \(1\)<\/summary>/);
});
test("provider labels are escaped; original zero and future forecast are not converted into payments", () => {
  const f = inventoryFixture(); f.accounts[0].name = "<script>fictional</script>"; f.accounts[0].balance.amountCents = 0; f.predictions[0].predictedOn = "2030-06-01";
  const html = renderToStaticMarkup(<FinanceSourceInventory snapshot={validateFinanceSourceInventory(f, inventoryNow)} now={inventoryNow} />);
  assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>|Date prévue déjà passée/); assert.match(html, /0,00/); assert.match(html, /dateTime="2030-06-01"/);
});
