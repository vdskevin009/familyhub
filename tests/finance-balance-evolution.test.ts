import test from "node:test";
import assert from "node:assert/strict";
import { receivedBalanceEvolution } from "../apps/web/src/finance-balance-evolution";
import type { FinanceBalanceObservation } from "../apps/worker/src/finance-model";
const now = Date.parse("2026-11-15T12:00:00Z");
const observation = (balanceCents: number, capturedAt = "2026-11-01T12:00:00Z", extra: Partial<FinanceBalanceObservation> = {}): FinanceBalanceObservation => ({ accountId: "synthetic", currency: "CAD", balanceCents, capturedAt, sourceAsOf: null, source: { name: "Synthetic receipt", sha256: "a".repeat(64) }, ...extra });
const project = (rows: FinanceBalanceObservation[]) => receivedBalanceEvolution(rows, "synthetic", "CAD", now);
test("zero and one capture never manufacture an evolution or a historical baseline", () => {
 assert.equal(project([]).changeCents, null); const result = project([observation(123456)]); assert.equal(result.points.length, 1); assert.equal(result.changeCents, null); assert.equal(result.points[0].changeCents, null); assert.equal(result.points[0].sourceAsOf, null);
});
test("irregular actual capture dates sort without intermediate points or source-date relabeling", () => {
 const rows = [observation(90000, "2026-11-10T15:00:00Z"), observation(100000, "2026-10-10T10:00:00Z", { sourceAsOf: "2026-10-09" }), observation(125000, "2026-11-01T12:00:00Z")], before = structuredClone(rows), result = project(rows);
 assert.equal(result.points.length, 3); assert.equal(result.changeCents, -10000); assert.deepEqual(result.points.map(p => p.changeCents), [null, 25000, -35000]); assert.equal(result.points[0].capturedAt, "2026-10-10T10:00:00Z"); assert.equal(result.points[0].sourceAsOf, "2026-10-09"); assert.deepEqual(rows, before);
});
test("replayed captures and equivalent timezone representations count once", () => {
 const row = observation(10000), result = project([row, structuredClone(row), { ...row, capturedAt: "2026-11-01T05:00:00-07:00" }]); assert.equal(result.points.length, 1); assert.equal(result.duplicates, 2); assert.equal(result.changeCents, null);
});
test("same-time amount, source-date or provenance contradictions block evolution", () => {
 const first = observation(10000), last = observation(12000, "2026-11-10T12:00:00Z");
 for (const change of [{ balanceCents: 11000 }, { sourceAsOf: "2026-10-31" }, { source: { name: "Conflicting receipt", sha256: "b".repeat(64) } }]) { const result = project([first, { ...first, ...change }, last]); assert.equal(result.conflicting, true); assert.equal(result.changeCents, null); }
});
test("other accounts and currencies never enter a comparison or currency conversion", () => {
 const result = project([observation(10000), observation(999999, "2026-11-02T12:00:00Z", { accountId: "other" }), observation(999999, "2026-11-03T12:00:00Z", { currency: "USD" })]); assert.equal(result.points.length, 1); assert.equal(result.excluded, 1); assert.equal(result.changeCents, null);
});
test("invalid, undated, future, missing-value and unproven captures never become zero points", () => {
 const rows = [observation(10000, "2026-11-01"), observation(10000, "2026-11-01T12:00:00"), observation(10000, "2026-02-30T12:00:00Z"), observation(10000, "2099-01-01T12:00:00Z"), observation(null as unknown as number), observation(NaN), observation(10000, undefined, { source: { name: "No digest" } })];
 const result = project(rows); assert.equal(result.points.length, 0); assert.equal(result.excluded, rows.length); assert.equal(result.changeCents, null);
});
test("observed zero, negative amounts and unchanged later captures are real data", () => {
 const result = project([observation(0, "2026-10-10T12:00:00Z"), observation(-100, "2026-11-01T12:00:00Z"), observation(-100, "2026-11-02T12:00:00Z")]); assert.equal(result.points.length, 3); assert.equal(result.changeCents, -100); assert.deepEqual(result.points.map(p => p.changeCents), [null, -100, 0]);
});
