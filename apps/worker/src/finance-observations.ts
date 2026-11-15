import type { FinanceBalanceObservation, FinanceCollection, FinanceData } from "./finance-model.js";
/** A capture clock is never a bank source date. Require an explicit timezone. */
export function financeTimestamp(value: unknown): string {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value.slice(0, 10) + "T12:00:00Z").toISOString().slice(0, 10) !== value.slice(0, 10)) throw new Error("Horodatage de collecte invalide.");
    return value;
}
export function financeCollection(value: unknown, accountIds: string[]): FinanceCollection {
    const v = value as FinanceCollection;
    if (!v || !Array.isArray(v.accountIds) || !v.accountIds.length || v.accountIds.length > 100 || new Set(v.accountIds).size !== v.accountIds.length || v.accountIds.some(id => !accountIds.includes(id))) throw new Error("Portée de collecte invalide.");
    return { retrievedAt: financeTimestamp(v.retrievedAt), accountIds: [...v.accountIds] };
}
export function archivedFinanceCollection(value: unknown, accountIds: string[]): FinanceCollection | null {
    try {
        const bundle = value as Record<string, any>;
        if (bundle.schema !== "familyhub.td.preparation.v1") return null;
        if (bundle.collection !== undefined) {
            const collection = financeCollection(bundle.collection, accountIds);
            return Date.parse(collection.retrievedAt) <= Date.now() + 5 * 60_000 ? collection : null;
        }
        const p = bundle.pluginEvidence;
        if (p?.schema !== "familyhub.finances-plugin-evidence.v1" || !p.plan?.accounts || typeof p.plan.accounts !== "object" || Array.isArray(p.plan.accounts)) return null;
        const ids = [...new Set(Object.values(p.plan.accounts))];
        if (!Array.isArray(bundle.accounts) || ids.length !== bundle.accounts.length || ids.some(id => !bundle.accounts.some((a: any) => a.accountId === id))) return null;
        if (p.plan.retrievedAt !== p.retrievedAt || (bundle.pluginFeedEvidence && bundle.pluginFeedEvidence.retrievedAt !== p.retrievedAt)) return null;
        const collection = financeCollection({ retrievedAt: p.retrievedAt, accountIds: ids }, accountIds);
        return Date.parse(collection.retrievedAt) <= Date.now() + 5 * 60_000 ? collection : null;
    } catch { return null; }
}
export function latestBalanceObservation(data: FinanceData, accountId: string): FinanceBalanceObservation | undefined {
    const account = data.accounts.find(a => a.id === accountId);
    const dated = [account?.asOf, ...data.holdings.filter(h => h.accountId === accountId).map(h => h.asOf)].filter((v): v is string => !!v && Number.isFinite(Date.parse(v)));
    const latestSource = Math.max(...dated.map(v => Date.parse(v)), -Infinity);
    return data.balanceObservations?.filter(o => o.accountId === accountId && Date.parse(o.capturedAt) <= Date.now() + 5 * 60_000 && Date.parse(o.capturedAt) >= latestSource).sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt))[0];
}
