import type { FinanceChangeResult, FinanceState } from "../../worker/src/finance-model";

/** Only an authoritative delta for this precise snapshot may advance its revision. */
export function applyFinanceDelta(state: FinanceState, result: FinanceChangeResult, requestId: string): FinanceState {
    if (result.operation?.id !== requestId || !result.revision || !Array.isArray(result.history) || !result.decisions || result.refreshRequired) throw new Error("Réponse du PC à vérifier; actualisation nécessaire.");
    if (state.operations?.some(op => op.id === requestId)) return state;
    const ids = new Set(state.data?.transactions.map(r => r.id));
    if (result.baseRevision !== state.revision || result.operation.baseRevision !== state.revision || result.operation.revision !== result.revision || result.history.length !== result.operation.count || new Set(result.history.map(e => e.id)).size !== result.history.length || result.history.length !== Object.keys(result.decisions).length || result.history.some(e => e.operationId !== requestId || !ids.has(e.id))) throw new Error("La réponse ne correspond plus aux données affichées. Actualisation nécessaire.");
    const decisions = Object.fromEntries(Object.entries(state.decisions));
    for (const event of result.history) {
        if (!Object.hasOwn(result.decisions, event.id) || JSON.stringify(result.decisions[event.id]) !== JSON.stringify(event.decision)) throw new Error("Réponse de décision incomplète.");
        if (event.decision === null) delete decisions[event.id];
        else Object.defineProperty(decisions, event.id, { value: event.decision, enumerable: true, writable: true, configurable: true });
    }
    return { ...state, revision: result.revision, decisions, decisionHistory: [...state.decisionHistory, ...result.history], operations: [...(state.operations ?? []), result.operation] };
}
