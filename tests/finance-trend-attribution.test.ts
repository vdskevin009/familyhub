import test from "node:test";
import assert from "node:assert/strict";
import { attributeSpendingDifference, leadingSpendingDifferences, trendEntryMonth } from "../apps/web/src/finance-trend-attribution.ts";
import { spendingTrend } from "../apps/web/src/finance-trends.ts";
import { parseFinancePreparation } from "../apps/worker/src/finance-import.ts";
import type { FinanceState } from "../apps/worker/src/finance-model.ts";
import { trendsFixture } from "./finance-trends-fixture.mjs";

function fixture(): FinanceState {
  const { bundle, decisions } = trendsFixture();
  return { schema: 1, revision: "fiction", importedAt: "2026-10-10", data: parseFinancePreparation(bundle), decisions, decisionHistory: [], imports: [] };
}
const trend = (state = fixture(), month = "2026-10", account = "", currency = "CAD") => spendingTrend(state, month, account, currency, "2026-10-10");
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
type Input = Parameters<typeof attributeSpendingDifference>[0];
function values(actual: number[], baseline: number[]): Input {
  const keys = ["groceries", "restaurants", "housing", "transport", "health"] as const;
  return {
    actualCents: sum(actual), baselineCents: sum(baseline), baselineReady: true, referenceIndicative: true,
    categories: actual.map((amount, index) => ({ key: keys[index], label: keys[index], actualCents: amount, baselineCents: baseline[index], count: 1, baselineCount: 1 })),
  };
}

test("month entry preserves selection or current month even when history ends earlier", () => {
  assert.equal(trendEntryMonth(undefined, "2030-04-10"), "2030-04");
  assert.equal(trendEntryMonth("2029-09", "2030-04-10"), "2029-09");
  assert.throws(() => trendEntryMonth("2030-13"));
});

test("A and B reconcile to the existing comparable-day difference without changing calculations", () => {
  const source = fixture(), input = trend(source), before = JSON.stringify({ source, input });
  const result = attributeSpendingDifference(input);
  assert.equal(input.elapsedDays, 9);
  assert.equal(result.available, true);
  assert.equal(result.actualCents, 78000);
  assert.equal(result.baselineCents, 71500);
  assert.equal(result.differenceCents, 6500);
  assert.equal(result.categories[0].key, "groceries");
  assert.equal(result.categories.find(row => row.key === "housing")!.differenceCents, 0);
  assert.equal(sum(result.categories.map(row => row.displayDifferenceCents)), result.displayDifferenceCents);
  assert.equal(sum(leadingSpendingDifferences(result, 1).map(row => row.displayDifferenceCents)), result.displayDifferenceCents);
  assert.equal(JSON.stringify({ source, input }), before);
});

test("largest drivers rank by difference, not spending; negative refunds stay left of zero", () => {
  const result = attributeSpendingDifference(values([100000, 1000, -5000], [100000, 5000, 0]));
  assert.deepEqual(result.categories.map(row => row.key), ["housing", "restaurants", "groceries"]);
  assert.equal(result.categories[0].displayDifferenceCents, -5000);
  assert.equal(result.scaleCents, 5000);
  assert.equal(result.differenceCents, -9000);
});

test("display rounding exactly reconciles fractional-cent references, mixed signs and deterministic ties", () => {
  for (const input of [values([1, 1, 1], [1 / 3, 1 / 3, 1 / 3]), values([0, -5, 0], [-1 / 3, -2 / 3, 0]), values([0, 0, 0, 0, 0], [1 / 6, 1 / 6, 1 / 6, 1 / 6, 1 / 6])]) {
    const result = attributeSpendingDifference(input);
    assert.equal(result.available, true);
    assert.equal(sum(result.categories.map(row => row.displayDifferenceCents)), result.displayDifferenceCents);
    assert.equal(sum(result.categories.map(row => row.displayBaselineCents)), Math.round(input.baselineCents!));
    const reordered = attributeSpendingDifference({ ...input, categories: [...input.categories].reverse() });
    assert.deepEqual(reordered.categories, result.categories);
    assert.equal(result.differenceCents, input.actualCents! - input.baselineCents!);
  }
});

test("all categories, including reference-only and zero differences, survive or enter reconciled Autres", () => {
  const input = values([100, 0, 300, 400, 500], [100, 200, 0, 350, 550]);
  input.categories[1].count = 0;
  const result = attributeSpendingDifference(input), overview = leadingSpendingDifferences(result, 2);
  assert.equal(result.categories.length, 5);
  assert.equal(overview.length, 3);
  assert.equal(overview.at(-1)!.label, "Autres catégories");
  assert.equal(new Set(overview.flatMap(row => row.categoryKeys)).size, 5);
  assert.equal(sum(overview.map(row => row.displayDifferenceCents)), result.displayDifferenceCents);
  assert.throws(() => leadingSpendingDifferences(result, 0));
});

test("missing observed or reference stays unavailable; real zero remains a valid signed comparison", () => {
  const input = values([0, 0], [0, 0]);
  const zero = attributeSpendingDifference(input);
  assert.equal(zero.available, true);
  assert.equal(zero.differenceCents, 0);
  assert.equal(zero.displayDifferenceCents, 0);
  const missing = attributeSpendingDifference({ ...input, actualCents: null });
  assert.equal(missing.unavailableReason, "observed-unavailable");
  assert.equal(missing.differenceCents, null);
  const noReference = attributeSpendingDifference({ ...input, baselineReady: false, baselineCents: null });
  assert.equal(noReference.actualCents, 0);
  assert.equal(noReference.unavailableReason, "reference-unavailable");
  assert.deepEqual(leadingSpendingDifferences(noReference), []);
});

test("missing or duplicate categories never produce a misleading partial explanation", () => {
  const input = values([100, 200], [50, 100]);
  for (const categories of [input.categories.slice(0, 1), [input.categories[0], input.categories[0]], [{ ...input.categories[0], actualCents: null }, input.categories[1]], [{ ...input.categories[0], baselineCents: Infinity }, input.categories[1]]]) {
    const result = attributeSpendingDifference({ ...input, categories });
    assert.equal(result.available, false);
    assert.equal(result.unavailableReason, "inconsistent-categories");
    assert.equal(result.differenceCents, null);
    assert.deepEqual(result.categories, []);
  }
});

test("partial indicative reference and account/currency filters retain existing eligibility and signs", () => {
  const source = fixture();
  source.data!.coverage.find(row => row.accountId === "card")!.earliest = "2026-08-15";
  for (const [account, currency] of [["", "CAD"], ["card", "CAD"], ["bank", "CAD"], ["card", "USD"]]) {
    const input = trend(source, "2026-10", account, currency), result = attributeSpendingDifference(input);
    assert.equal(result.actualCents, input.actualCents);
    assert.equal(result.baselineCents, input.baselineCents);
    assert.equal(result.indicative, input.referenceIndicative);
    if (input.actualCents !== null && input.baselineCents !== null) {
      assert.equal(result.differenceCents, input.actualCents - input.baselineCents);
      assert.equal(sum(result.categories.map(row => row.displayDifferenceCents)), result.displayDifferenceCents);
    } else assert.equal(result.available, false);
  }
  assert.equal(attributeSpendingDifference(trend(source)).indicative, true);
});

test("repeated month changes recalculate attribution without stale categories or input mutation", () => {
  const source = fixture(), before = JSON.stringify(source);
  const results = ["2026-10", "2026-08", "2026-03", "2026-10"].map(month => attributeSpendingDifference(trend(source, month)));
  assert.deepEqual(results[0], results[3]);
  assert.equal(results[2].available, false);
  assert.equal(JSON.stringify(source), before);
});
