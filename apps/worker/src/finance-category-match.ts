import { classifiedRows, decisionCategoryAllowed, type FinanceDecision, type FinanceState } from "./finance-model.js";

/** No fuzzy matching: accents, punctuation, digits and merchant/location suffixes remain significant. */
export const categoryNameKey = (name: string) => name.normalize("NFC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("fr-CA");
export function categoryScope(state: FinanceState, id: string, decision: FinanceDecision, rows = classifiedRows(state)) {
    const selected = rows.find(r => r.id === id), key = categoryNameKey(selected?.description ?? "");
    const matching = rows.filter(r => r.id === id || Boolean(key && categoryNameKey(r.description) === key));
    const compatible = matching.filter(r => r.id === id || decisionCategoryAllowed(decision.category, r.nature));
    // Reaffirm the selected row; do not rewrite already-correct explicit decisions on other rows.
    const affected = compatible.filter(r => r.id === id || !Object.hasOwn(state.decisions, r.id) || state.decisions[r.id].category !== decision.category);
    return { key, matching: matching.length, incompatible: matching.length - compatible.length, affected };
}

export function financeUndoOptions(state: FinanceState) {
    const latest = new Map(state.decisionHistory.map(e => [e.id, e.operationId]));
    const undone = new Set((state.operations ?? []).map(op => op.undoOf).filter(Boolean));
    return (state.operations ?? []).filter(op => op.kind !== "undo").slice(-10).reverse().map(op => ({
        ...op, canUndo: !undone.has(op.id) && state.decisionHistory.filter(e => e.operationId === op.id).every(e => latest.get(e.id) === op.id),
    }));
}
