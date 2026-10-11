import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm, readdir, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { categoryFixture, categoryDecisions } from "./finance-category-fixture.mjs";
import { parseFinancePreparation } from "../apps/worker/dist/finance-import.js";
import { prepareFinanceChange, FinanceConflict } from "../apps/worker/dist/finance-changes.js";
import { categoryNameKey, categoryScope, financeUndoOptions } from "../apps/worker/dist/finance-category-match.js";
import { validateFinanceState } from "../apps/worker/dist/finance-validation.js";
import { FinanceLibrary } from "../apps/worker/dist/finance-library.js";
import { classifiedRows, summarizeSpending, suggestClassification } from "../apps/worker/dist/finance-model.js";

const state = () => ({ schema: 1, revision: "initial", importedAt: "2026-10-01", data: parseFinancePreparation(categoryFixture()), decisions: structuredClone(categoryDecisions), decisionHistory: [], imports: [] });
const decision = { nature: "expense", category: "groceries", note: "Primary synthetic note" };
const input = (s, extra = {}) => ({ requestId: randomUUID(), expectedRevision: s.revision, kind: "decision", id: "a", decision, ...extra });
const group = s => prepareFinanceChange(s, input(s, { allSameName: true, expectedCount: 10 }));
const undo = (s, operation, extra = {}) => prepareFinanceChange(s, { requestId: randomUUID(), expectedRevision: s.revision, kind: "undo", undoOf: operation.id, ...extra });

test("school category is explicit only and persists single/bulk choices without changing source facts or totals", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fh-school-category-"));
    try {
        const lib = new FinanceLibrary(dir);
        let s = (await lib.import({ bundle: categoryFixture(), apply: true, expectedRevision: "empty" })).state;
        for (const [id, decision] of Object.entries(categoryDecisions)) s = await lib.decide({ id, decision, expectedRevision: s.revision });
        const facts = structuredClone(s.data), original = classifiedRows(s), summary = summarizeSpending(s, "2026-01-01", "2026-12-31");
        assert.notEqual(suggestClassification({ ...s.data.transactions[0], description: "Jasmine school" }).category, "jasmine-school");
        const selected = { ...decision, category: "jasmine-school" };
        const single = await lib.change(input(s, { decision: selected }));
        assert.equal(single.operation.count, 1);
        s = await new FinanceLibrary(dir).read();
        assert.equal(s.decisions.a.category, "jasmine-school");
        assert.equal(s.decisions.confirmed.category, "groceries");
        const bulk = await lib.change(input(s, { decision: selected, allSameName: true, expectedCount: 11 }));
        assert.equal(bulk.operation.count, 11);
        const saved = await new FinanceLibrary(dir).read();
        for (const row of categoryScope(s, "a", selected).affected) {
            assert.equal(saved.decisions[row.id].category, "jasmine-school");
            if (row.id !== "a") {
                assert.equal(saved.decisions[row.id].nature, original.find(r => r.id === row.id).nature);
                assert.equal(saved.decisions[row.id].note, s.decisions[row.id]?.note ?? "");
            }
        }
        const updated = summarizeSpending(saved, "2026-01-01", "2026-12-31");
        assert.ok(updated.categories.find(c => c.key === "jasmine-school").count > 0);
        assert.equal(updated.totalCents, summary.totalCents);
        assert.deepEqual(saved.data, facts);
        assert.deepEqual(validateFinanceState(saved), saved);
    } finally { await rm(dir, { recursive: true, force: true }); }
});

test("exact normalized names retain accents, punctuation, digits and suffixes", () => {
    assert.equal(categoryNameKey("  CaFe\u0301 \t SHOP 01 "), categoryNameKey("café shop 01"));
    for (const name of ["cafe shop 01", "café-shop 01", "café shop 02", "café shop 01 VANCOUVER"]) assert.notEqual(categoryNameKey(name), categoryNameKey("café shop 01"));
    const s = state(), scope = categoryScope(s, "a", decision);
    assert.equal(scope.matching, 11); assert.equal(scope.affected.length, 10);
    assert.ok(scope.affected.some(r => r.accountId === "usd" && r.currency === "USD"));
    assert.ok(scope.affected.some(r => r.date.startsWith("2026-04")));
});

test("bulk changes category only on other rows, retaining exclusions, notes, prior audit and exact source facts", () => {
    const s = state(), original = JSON.stringify(s), before = classifiedRows(s), total = summarizeSpending(s, "2026-01-01", "2026-12-31").totalCents;
    s.decisionHistory.push({ id: "c", previous: null, decision: s.decisions.c, at: "legacy" });
    const { next, response } = group(s);
    assert.equal(response.operation.count, 10); assert.equal(response.operation.kind, "same-name");
    assert.equal(response.history.length, 10); assert.ok(!("data" in response));
    assert.equal(next.decisionHistory.length, 11); assert.deepEqual(next.decisionHistory[0], s.decisionHistory[0]);
    assert.deepEqual(next.data, JSON.parse(original).data); assert.deepEqual(next.imports, s.imports);
    for (const id of Object.keys(response.decisions).filter(id => id !== "a")) {
        assert.equal(next.decisions[id].nature, before.find(r => r.id === id).nature);
        assert.equal(next.decisions[id].note, s.decisions[id]?.note ?? "");
        assert.equal(next.decisions[id].category, "groceries");
    }
    assert.deepEqual(next.decisions.confirmed, s.decisions.confirmed);
    for (const id of ["number", "punctuation", "accent"]) assert.equal(next.decisions[id], undefined);
    assert.equal(summarizeSpending(next, "2026-01-01", "2026-12-31").totalCents, total);
    assert.deepEqual(validateFinanceState(next), next);
});

test("single action stays single; incompatible peers and blank names cannot expand scope", () => {
    const s = state(); assert.equal(prepareFinanceChange(s, input(s)).response.operation.count, 1);
    const d = { ...decision, category: "savings-investments", nature: "investment" }, scope = categoryScope(s, "a", d);
    assert.equal(scope.incompatible, 6); assert.equal(scope.affected.length, 5);
    const changed = prepareFinanceChange(s, input(s, { decision: d, allSameName: true, expectedCount: scope.affected.length })).next;
    assert.equal(changed.decisions.refund.category, "other"); assert.equal(changed.decisions.repayment.category, "other");
    s.data.transactions[0].description = "   ";
    assert.throws(() => prepareFinanceChange(s, input(s, { allSameName: true, expectedCount: 1 })), FinanceConflict);
    assert.equal(prepareFinanceChange(s, input(s)).response.operation.count, 1);
});

test("stale revisions, scope changes, invalid identifiers and debit/credit changes fail without mutation", () => {
    const s = state(), bytes = JSON.stringify(s);
    for (const extra of [{ expectedRevision: "old" }, { allSameName: true, expectedCount: 9 }, { allSameName: true }, { requestId: "invalid" }, { id: "missing" }, { decision: { ...decision, nature: "refund" } }, { decision: { ...decision, category: "savings-investments" } }]) assert.throws(() => prepareFinanceChange(s, input(s, extra)));
    assert.equal(JSON.stringify(s), bytes);
});

test("undo restores exact prior choices including absence and preserves unrelated later decisions", () => {
    const s = state(), first = group(s), afterOther = prepareFinanceChange(first.next, input(first.next, { id: "number", decision: { ...decision, category: "restaurants" } }));
    const restored = undo(afterOther.next, first.response.operation);
    assert.equal(restored.response.operation.kind, "undo"); assert.equal(restored.response.operation.count, 10);
    assert.equal(Object.hasOwn(restored.next.decisions, "a"), false); assert.equal(Object.hasOwn(restored.next.decisions, "usd"), false);
    for (const [id, d] of Object.entries(s.decisions)) assert.deepEqual(restored.next.decisions[id], d);
    assert.equal(restored.next.decisions.number.category, "restaurants");
    assert.deepEqual(restored.next.data, s.data); assert.equal(validateFinanceState(restored.next), restored.next);
    assert.equal(financeUndoOptions(restored.next).find(op => op.id === first.response.operation.id).canUndo, false);
    assert.throws(() => undo(restored.next, first.response.operation), FinanceConflict);
});

test("one changed member rejects the entire undo, even after changing away and back", () => {
    const first = group(state());
    const edited = prepareFinanceChange(first.next, input(first.next, { id: "b", decision: { ...decision, category: "restaurants" } }));
    const back = prepareFinanceChange(edited.next, input(edited.next, { id: "b" })), bytes = JSON.stringify(back.next);
    assert.equal(financeUndoOptions(back.next).find(op => op.id === first.response.operation.id).canUndo, false);
    assert.throws(() => undo(back.next, first.response.operation), FinanceConflict);
    assert.equal(JSON.stringify(back.next), bytes);
});

test("idempotent retries survive revision changes without returning an obsolete delta", () => {
    const s = state(), request = input(s, { allSameName: true, expectedCount: 10 }), first = prepareFinanceChange(s, request);
    const retry = prepareFinanceChange(first.next, request);
    assert.equal(retry.next, null); assert.equal(retry.response.replayed, true); assert.deepEqual(retry.response.decisions, first.response.decisions);
    assert.throws(() => prepareFinanceChange(first.next, { ...request, decision: { ...decision, category: "restaurants" } }), /identifiant/);
    const other = prepareFinanceChange(first.next, input(first.next, { id: "number" }));
    const late = prepareFinanceChange(other.next, request);
    assert.equal(late.next, null); assert.equal(late.response.refreshRequired, true); assert.deepEqual(late.response.history, []);
    assert.equal(late.response.revision, other.next.revision);
});

test("new operation validation rejects incomplete, duplicate or orphan audit metadata", () => {
    const { next } = group(state());
    for (const corrupt of [s => s.operations[0].count++, s => s.decisionHistory.push(s.decisionHistory[0]), s => { s.operations = undefined; }, s => { s.decisionHistory[0].decision.nature = "invalid"; }, s => { s.operations[0].id = "-".repeat(36); }, s => { s.operations[0].undoOf = randomUUID(); }]) {
        const copy = structuredClone(next); corrupt(copy); assert.throws(() => validateFinanceState(copy), /invalide/);
    }
});

test("history capacity is checked before creating any partial group", () => {
    const s = state(); s.decisionHistory = Array.from({ length: 49995 }, () => ({ id: "c", previous: null, decision: s.decisions.c, at: "legacy" }));
    assert.throws(() => group(s), /capacité/); assert.equal(s.revision, "initial"); assert.equal(s.operations, undefined);
});

test("serialized concurrent writers: one commit, one conflict; persisted retry/undo preserve original imports", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fh-category-"));
    try {
        let lib = new FinanceLibrary(dir), s = (await lib.import({ bundle: categoryFixture(), apply: true, expectedRevision: "empty" })).state;
        for (const [id, decision] of Object.entries(categoryDecisions)) s = await lib.decide({ id, decision, expectedRevision: s.revision });
        const originalData = JSON.stringify(s.data), originalFiles = await readdir(join(dir, "sources")), request = input(s, { allSameName: true, expectedCount: 10 });
        const outcomes = await Promise.allSettled([lib.change(request), lib.change(input(s, { id: "number" }))]);
        assert.equal(outcomes[0].status, "fulfilled"); assert.equal(outcomes[1].status, "rejected"); assert.ok(outcomes[1].reason instanceof FinanceConflict);
        lib = new FinanceLibrary(dir); const saved = await lib.read(), retry = await lib.change(request);
        assert.equal(saved.operations.length, 1); assert.equal(retry.replayed, true); assert.equal((await lib.read()).revision, saved.revision);
        const undone = await lib.change({ requestId: randomUUID(), expectedRevision: saved.revision, kind: "undo", undoOf: request.requestId });
        assert.equal(undone.operation.count, 10); assert.deepEqual((await lib.read()).decisions, s.decisions);
        assert.equal(JSON.stringify((await lib.read()).data), originalData);
        assert.deepEqual(await readdir(join(dir, "sources")), originalFiles);
        assert.equal((await lib.import({ bundle: categoryFixture(), apply: true, expectedRevision: undone.revision })).alreadyImported, true);
    } finally { await rm(dir, { recursive: true, force: true }); }
});

test("failed atomic rename never acknowledges success or overwrites source data", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fh-category-fail-"));
    try {
        const lib = new FinanceLibrary(dir), s = (await lib.import({ bundle: categoryFixture(), apply: true, expectedRevision: "empty" })).state;
        const ledger = join(dir, "ledger.json"), before = await readFile(ledger);
        // Simulate an I/O failure before an atomic replacement, only inside our temporary fixture directory.
        lib.read = async () => s;
        await rm(ledger); await mkdir(ledger);
        await assert.rejects(lib.change(input(s)));
        assert.equal((await readdir(ledger)).length, 0);
        await rm(ledger, { recursive: true }); await writeFile(ledger, before);
        assert.deepEqual(await new FinanceLibrary(dir).read(), s);
    } finally { await rm(dir, { recursive: true, force: true }); }
});
