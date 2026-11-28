import { createHash, randomUUID } from "node:crypto";
import { categoryScope } from "./finance-category-match.js";
import { decisionCategoryAllowed, expenseCategories, natures, type FinanceState, type FinanceDecision, type FinanceAuditEvent, type FinanceOperation, type FinanceChangeResult } from "./finance-model.js";

export class FinanceConflict extends Error {}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export type FinanceChangeInput = { requestId?: unknown; expectedRevision?: unknown; kind?: unknown; id?: unknown; decision?: unknown; allSameName?: unknown; expectedCount?: unknown; undoOf?: unknown };
function cleanDecision(value: unknown): FinanceDecision {
    const d = value as FinanceDecision;
    if (!d || !Object.hasOwn(natures, d.nature) || !Object.hasOwn(expenseCategories, d.category) || !decisionCategoryAllowed(d.category, d.nature) || typeof d.note !== "string" || d.note.length > 1000) throw new Error("Invalid decision.");
    return { nature: d.nature, category: d.category, note: d.note, updatedAt: "" };
}
function result(state: FinanceState, operation: FinanceOperation, replayed = false): FinanceChangeResult {
    const refreshRequired = state.revision !== operation.revision;
    const history = refreshRequired ? [] : state.decisionHistory.filter(e => e.operationId === operation.id);
    return { baseRevision: operation.baseRevision, revision: state.revision, operation, decisions: Object.fromEntries(history.map(e => [e.id, e.decision])), history, replayed, refreshRequired };
}
/** Compute a complete transaction before the single atomic write. Source records never enter the delta. */
export function prepareFinanceChange(state: FinanceState, input: FinanceChangeInput): { next: FinanceState | null; response: FinanceChangeResult } {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Modification invalide.");
    if (typeof input.requestId !== "string" || !uuid.test(input.requestId)) throw new Error("Identifiant de modification invalide.");
    if (input.kind !== "decision" && input.kind !== "undo") throw new Error("Invalid financial action.");
    const decision = input.kind === "decision" ? cleanDecision(input.decision) : null;
    if (input.kind === "decision" && (typeof input.id !== "string" || (input.allSameName !== undefined && typeof input.allSameName !== "boolean"))) throw new Error("Invalid scope.");
    if (input.kind === "undo" && (typeof input.undoOf !== "string" || !uuid.test(input.undoOf))) throw new Error("Annulation invalide.");
    const requestHash = createHash("sha256").update(JSON.stringify(input.kind === "decision"
        ? { kind: input.kind, id: input.id, decision, allSameName: input.allSameName === true, expectedCount: input.expectedCount }
        : { kind: input.kind, undoOf: input.undoOf })).digest("hex");
    const earlier = (state.operations ?? []).find(op => op.id === input.requestId);
    if (earlier) {
        if (earlier.requestHash !== requestHash) throw new Error("This identifier belongs to a different change.");
        return { next: null, response: result(state, earlier, true) };
    }
    if (input.expectedRevision !== state.revision) throw new FinanceConflict("Another change was saved. Reload the decision from your PC before trying again.");
    const at = new Date().toISOString(), history: FinanceAuditEvent[] = [];
    if (decision) {
        const row = state.data?.transactions.find(r => r.id === input.id);
        if (!row) throw new Error("Transaction not found.");
        if ((decision.nature === "refund" && row.outflowCents >= 0) || (decision.nature === "expense" && row.outflowCents < 0)) throw new Error("The source debit or credit direction must be kept.");
        // A single decision does not need classification or name matching of the entire history.
        const scope = input.allSameName === true ? categoryScope(state, row.id, decision) : null;
        const affected = scope ? scope.affected : [{ ...row, nature: decision.nature }];
        if (scope && (!scope.key || input.expectedCount !== affected.length)) throw new FinanceConflict("The scope has changed. Review the number of transactions before confirming.");
        for (const target of affected) {
            const previous = Object.hasOwn(state.decisions, target.id) ? state.decisions[target.id] : null;
            const next = target.id === input.id ? { ...decision, updatedAt: at }
                : { nature: target.nature, category: decision.category, note: previous?.note ?? "", updatedAt: at };
            history.push({ id: target.id, previous, decision: next, at, operationId: input.requestId });
        }
    } else {
        const operation = (state.operations ?? []).find(op => op.id === input.undoOf && op.kind !== "undo");
        const events = state.decisionHistory.filter(e => e.operationId === input.undoOf);
        if (!operation || !events.length || (state.operations ?? []).some(op => op.undoOf === input.undoOf)) throw new FinanceConflict("Cette modification n’est plus annulable.");
        const latestById = new Map(state.decisionHistory.map(event => [event.id, event]));
        for (const event of events) {
            const latest = latestById.get(event.id);
            if (latest?.operationId !== operation.id || JSON.stringify(state.decisions[event.id] ?? null) !== JSON.stringify(event.decision)) throw new FinanceConflict("A transaction in this group has changed. The group cannot be undone without overwriting the newer decision.");
            history.push({ id: event.id, previous: event.decision, decision: event.previous, at, operationId: input.requestId });
        }
    }
    if (state.decisionHistory.length + history.length > 50000 || (state.operations?.length ?? 0) >= 50000) throw new Error("The history is full. No decisions were changed.");
    const operation: FinanceOperation = { id: input.requestId, kind: decision ? input.allSameName === true ? "same-name" : "decision" : "undo", at, count: history.length,
        baseRevision: state.revision, revision: randomUUID(), requestHash, ...(!decision ? { undoOf: input.undoOf as string } : {}) };
    const decisions = Object.fromEntries(Object.entries(state.decisions));
    for (const event of history) {
        if (event.decision === null) delete decisions[event.id];
        else Object.defineProperty(decisions, event.id, { value: event.decision, enumerable: true, writable: true, configurable: true });
    }
    const next: FinanceState = { ...state, revision: operation.revision, decisions, decisionHistory: [...state.decisionHistory, ...history], operations: [...(state.operations ?? []), operation] };
    return { next, response: result(next, operation) };
}
