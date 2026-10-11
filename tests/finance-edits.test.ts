import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { applyFinanceDelta } from "../apps/web/src/finance-edits";
import { prepareFinanceChange } from "../apps/worker/src/finance-changes";
import { parseFinancePreparation } from "../apps/worker/src/finance-import";
import { categoryFixture, categoryDecisions } from "./finance-category-fixture.mjs";
import type { FinanceState } from "../apps/worker/src/finance-model";
const state = (): FinanceState => ({ schema: 1, revision: "initial", importedAt: "2026-10-01", data: parseFinancePreparation(categoryFixture()), decisions: structuredClone(categoryDecisions), decisionHistory: [], imports: [] });
test("authoritative delta preserves source identity, appends audit once and reverses null decisions", () => {
    const s = state(), requestId = randomUUID(), changed = prepareFinanceChange(s, { requestId, expectedRevision: s.revision, kind: "decision", id: "a", allSameName: true, expectedCount: 10, decision: { nature: "expense", category: "groceries", note: "Synthetic" } });
    const saved = applyFinanceDelta(s, changed.response, requestId);
    assert.equal(saved.data, s.data); assert.deepEqual(saved, changed.next);
    assert.equal(applyFinanceDelta(saved, changed.response, requestId), saved);
    const undoId = randomUUID(), undone = prepareFinanceChange(saved, { requestId: undoId, expectedRevision: saved.revision, kind: "undo", undoOf: requestId });
    const restored = applyFinanceDelta(saved, undone.response, undoId);
    assert.deepEqual(restored.decisions, s.decisions); assert.equal(restored.data, s.data);
});
test("incomplete, stale or mismatched acknowledgements cannot advance local state", () => {
    const s = state(), id = randomUUID(), response = prepareFinanceChange(s, { requestId: id, expectedRevision: s.revision, kind: "decision", id: "a", decision: { nature: "expense", category: "groceries", note: "" } }).response;
    for (const corrupt of [r => { r.baseRevision = "old"; }, r => { r.operation.id = randomUUID(); }, r => { r.refreshRequired = true; }, r => { r.decisions = {}; }, r => { r.history[0].id = "missing"; }, r => { r.decisions.a = null; }, r => { r.decisions.extra = null; }, r => { r.operation.count++; }]) {
        const clone = structuredClone(response); corrupt(clone); assert.throws(() => applyFinanceDelta(s, clone, id));
    }
    assert.equal(s.revision, "initial"); assert.equal(s.decisions.a, undefined);
});
