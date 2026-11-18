import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { primaryDestination } from "../src/navigation";
import { sumKnownAmounts } from "../src/ui/known-amount";
import { Notice } from "../src/ui/primitives";
import type { AppView } from "../src/types";

test("every existing route has exactly one primary destination, including mortgage and legacy documents", () => {
  const primary: AppView[] = ["today", "reimbursements", "finances", "projects", "other"];
  const groups: [AppView, AppView[]][] = [
    ["projects", ["projects", "mortgage", "property", "vehicle", "groceries"]],
    ["finances", ["finances", "contributions"]],
    ["other", ["other", "savings", "documents", "invoices", "desjardins", "blue-cross", "notifications", "inbox", "plan", "money", "more"]],
    ["today", ["today"]], ["reimbursements", ["reimbursements"]]
  ];
  for (const [destination, routes] of groups) for (const route of routes) {
    assert.equal(primaryDestination(route), destination, route);
    assert.equal(primary.filter(item => item === primaryDestination(route)).length, 1, route);
  }
});

test("reimbursement summary keeps unknown, reported zero, partial amounts and refunds distinct", () => {
  assert.deepEqual(sumKnownAmounts([null, undefined, NaN, Infinity]), { amount: null, unknown: 4 });
  assert.deepEqual(sumKnownAmounts([0, 0]), { amount: 0, unknown: 0 });
  assert.deepEqual(sumKnownAmounts([0, null]), { amount: 0, unknown: 1 });
  assert.deepEqual(sumKnownAmounts([180, -30, null]), { amount: 150, unknown: 1 });
  assert.deepEqual(sumKnownAmounts([]), { amount: 0, unknown: 0 });
});

test("informational notices do not claim success; explicit success and failure retain their meanings", () => {
  const info = renderToStaticMarkup(createElement(Notice, {}, "Aucune collecte confirmée"));
  assert.match(info, /app-notice info/); assert.doesNotMatch(info, /circle-check|check-circle|app-notice success/);
  assert.match(renderToStaticMarkup(createElement(Notice, { success: true }, "Enregistré")), /app-notice success/);
  assert.match(renderToStaticMarkup(createElement(Notice, { error: true, success: true }, "Échec")), /app-notice error.*role="alert"/);
});
