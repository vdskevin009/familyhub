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

// Presentation-only account discovery: synthetic canonical and source evidence stay separate.
import FinanceReceivedAccounts from "../apps/web/src/views/FinanceReceivedAccounts";
import { FinanceLibrary } from "../apps/worker/dist/finance-library.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
// @ts-ignore Shared synthetic fixture.
import { financeFixture } from "./finance-fixture.mjs";
// @ts-ignore Shared synthetic fixture.
import { observationsFixture } from "./finance-observations-fixture.mjs";
async function syntheticAccountData() {
  const dir = await mkdtemp(join(tmpdir(), "familyhub-received-view-"));
  try {
    const library = new FinanceLibrary(dir);
    const before = (await library.import({ bundle: financeFixture(), apply: true, expectedRevision: "empty" })).state;
    return (await library.import({ bundle: observationsFixture(before), apply: true, expectedRevision: before.revision })).state.data!;
  } finally { await rm(dir, { recursive: true, force: true }); }
}
const noOpen = () => { throw new Error("Static view must not navigate or write"); };
test("received accounts are two open evidence groups, preserving two capture clocks and the hidden historical register", async () => {
  const data = await syntheticAccountData(), before = JSON.stringify(data), f = inventoryFixture();
  f.collectedAt = "2026-11-02T12:00:00Z";
  f.accounts = Array.from({ length: 7 }, (_, i) => ({ ...f.accounts[0], sourceKey: "fsi_" + String(i).repeat(64), credit: null, name: i === 0 ? data.accounts[0].name : "Compte source fictif " + i }));
  f.predictions = []; f.availability.accounts.observedCount = 7; f.availability.recurring.observedCount = 0; f.availability.liabilities.observedCount = 0;
  const snapshot = validateFinanceSourceInventory(f, inventoryNow);
  const html = renderToStaticMarkup(<FinanceReceivedAccounts data={data} inventory={{ status: "ready", snapshot }} onOpen={noOpen} historicalOpen={false} onHistoricalOpen={noOpen} />);
  assert.equal((html.match(/data-received-account="true"/g) ?? []).length, 2);
  assert.equal((html.match(/class="finance-source-status"/g) ?? []).length, 7);
  assert.match(html, /Voir les 7 comptes source non rapprochés/); assert.match(html, /Comptes rapprochés du registre/); assert.match(html, /Comptes source non rapprochés/);
  assert.match(html, /<time dateTime="2026-11-01T12:34:56Z"/); assert.match(html, /<time dateTime="2026-11-02T12:00:00.000Z"/);
  assert.match(html, /Date bancaire inconnue/); assert.match(html, /Date bancaire non fournie/);
  assert.match(html, /<details class="surface finance-historical-accounts">/);
  assert.match(html, /Observation historique · 2026-10-09/);
  assert(html.indexOf('finance-source-accounts') < html.indexOf('finance-historical-accounts'));
  assert.doesNotMatch(html, /Solde total|Patrimoine total|9 comptes|fsi_[a-f0-9]/);
  assert.equal(JSON.stringify(data), before);
});
test("old workers retain every historical account including cards; missing source evidence has no fabricated balance", async () => {
  const data = await syntheticAccountData(); data.balanceObservations = [];
  const html = renderToStaticMarkup(<FinanceReceivedAccounts data={data} inventory={{ status: "unsupported", snapshot: null }} onOpen={noOpen} historicalOpen={null} onHistoricalOpen={noOpen} />);
  assert.match(html, /<details class="surface finance-historical-accounts" open="">/);
  assert.equal((html.match(/data-investment-account=/g) ?? []).length, 4);
  assert.match(html, /Carte de test/); assert.match(html, /nécessite une mise à jour/);
  assert.doesNotMatch(html, /data-received-account|Date bancaire inconnue/);
  for (const status of ["loading", "error"] as const) {
    const empty = renderToStaticMarkup(<FinanceReceivedAccounts data={null} inventory={{ status, snapshot: null }} onOpen={noOpen} historicalOpen={false} onHistoricalOpen={noOpen} />);
    assert.match(empty, /role="status"/); assert.doesNotMatch(empty, /data-investment-account|0,00|Date bancaire inconnue/);
  }
});
test("newer bank-dated evidence does not erase prior receipts or mislabel the historical date", async () => {
  const data = await syntheticAccountData(); data.accounts.find(a => a.id === "bank")!.asOf = "2031-01-01";
  const before = JSON.stringify(data);
  const html = renderToStaticMarkup(<FinanceReceivedAccounts data={data} inventory={{ status: "ready", snapshot: null }} onOpen={noOpen} historicalOpen={true} onHistoricalOpen={noOpen} />);
  assert.equal((html.match(/data-received-account="true"/g) ?? []).length, 1);
  assert.match(html, /Observation historique · 2031-01-01/); assert.match(html, /open=""/);
  assert.equal(JSON.stringify(data), before); assert.equal(data.balanceObservations?.length, 2);
});
