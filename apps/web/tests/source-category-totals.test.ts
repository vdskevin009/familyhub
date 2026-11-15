import test from "node:test";
import assert from "node:assert/strict";
import { sourceCategoryTotals, sourceCategoryIncludes } from "../src/source-category-totals";
import type { summarizeSourceExpenses } from "../../worker/src/finance-source-expenses-model";
type Row = ReturnType<typeof summarizeSourceExpenses>["rows"][number];
const item = (amount: number, kind: Row["kind"] = "expense", category = "groceries", pending = false): Row => ({ kind, row: { sourceKey: "synthetic", accountSourceKey: "synthetic", pendingSourceKey: null, date: "2026-11-10", description: "Fictional fixture", outflowCents: amount, currency: "CAD", pending, category: { primary: category, detailed: null, confidence: "HIGH" }, linkedTransfer: false } });
test("category totals reconcile net and retain refunds without including pending or transfers", () => {
  const rows = [item(10000), item(-2000, "refund"), item(5000, "expense", "shopping", true), item(3000, "transfer"), item(-8000, "refund", "travel"), item(1000, "expense", "travel"), item(500, "ambiguous")];
  const totals = sourceCategoryTotals(rows);
  assert.deepEqual(totals, [{ key: "groceries", netCents: 8000, grossCents: 10000, refundCents: 2000, count: 2 }, { key: "travel", netCents: -7000, grossCents: 1000, refundCents: 8000, count: 2 }]);
  assert.equal(totals.reduce((n, t) => n + t.netCents, 0), 1000);
  assert.equal(rows.filter(r => sourceCategoryIncludes(r, "groceries")).length, 2);
});
test("empty evidence stays empty; a genuine zero net category retains its two source rows", () => {
  assert.deepEqual(sourceCategoryTotals([]), []);
  assert.equal(sourceCategoryTotals([item(500), item(-500, "refund")])[0].netCents, 0);
  assert.equal(sourceCategoryTotals([item(500), item(-500, "refund")])[0].count, 2);
});
