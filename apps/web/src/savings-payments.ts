import { classifiedRows, fullObservedMonth, monthRange, type FinanceState } from "../../worker/src/finance-model";
import { contractMonthly, contractTaxes, type SavingsContract } from "./savings";
export type PaidRow = ReturnType<typeof classifiedRows>[number];
export type PaymentReview = { row: PaidRow; contractIds: string[]; reason: string };
export type ContractPayments = { contractId: string; rows: PaidRow[]; history: PaidRow[]; cents: number | null; latest: PaidRow | null; repeated: boolean; invoiceMatch: PaidRow | null; referenceMonthly: number | null };
const compact = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
/** Strong provider labels propose a grouping, never a policy identity or tax split. */
export function providerMatches(contract: SavingsContract, description: string): boolean {
    const p = compact(contract.provider), d = compact(description), n = compact(contract.name);
    if (contract.category === "mortgage") return /\bMTG\b|MORTGAGE/i.test(description);
    if (p.startsWith("TD") && contract.category.includes("insurance")) return /^TD(?:INS|ASSUR)/.test(d);
    if (n.includes("CHATGPT") || p === "OPENAI") return d.includes("CHATGPT");
    if (p === "BCHYDRO") return d.startsWith("BCHYDRO");
    if (["APPLE", "GOOGLE", "TD", "RBC", "BMO", "CIBC"].includes(p)) return false;
    return p.length >= 4 && d.startsWith(p);
}
function includedReason(contract: SavingsContract, description: string): string | null {
    const services = compact((contract.services ?? []).filter(s => s.pricing === "included").map(s => s.name).join(" ")), d = compact(description);
    if ((services.includes("NETFLIX") && d.startsWith("NETFLIX")) || (services.includes("DISNEY") && d.startsWith("DISNEY"))) return "Paiement direct pour un service cité comme inclus dans le contrat actuel. Vérifier la facture et les dates d’effet; aucun doublon présumé.";
    if (services.includes("APPLETV") && d.startsWith("APPLECOMBILL")) return "Libellé Apple générique : il ne prouve pas un paiement Apple TV. Produit et facture à vérifier.";
    return null;
}
/** No write, allocation, uniform tax uplift, FX conversion, or contract-rate inference. */
export function reconcilePayments(contracts: SavingsContract[], state: FinanceState | null, from: string, to: string) {
    const grouped = new Map(contracts.map(c => [c.id, [] as PaidRow[]]));
    const reviews: PaymentReview[] = [];
    const rows = classifiedRows(state ?? { schema: 1, revision: "empty", importedAt: null, data: null, decisions: {}, decisionHistory: [], imports: [] });
    for (const row of rows) {
        if (row.status !== "posted") continue;
        if (["transfer", "repayment", "investment", "income", "duplicate"].includes(row.nature)) continue;
        const matches = contracts.filter(c => providerMatches(c, row.description));
        const compatible = matches.filter(c => (c.billing?.currency ?? "CAD") === row.currency);
        if (matches.length === 1 && compatible.length === 1 && ["expense", "refund"].includes(row.nature) && (!row.duplicateCandidate || row.reviewed)) grouped.get(matches[0].id)!.push(row);
        else if (matches.length) reviews.push({ row, contractIds: matches.map(c => c.id), reason: matches.length > 1 ? "Plusieurs contrats possibles pour ce fournisseur; montant non affecté." : !compatible.length ? "La devise du paiement diffère du contrat; aucune conversion." : "Nature ou doublon possible à confirmer dans Finances; montant non affecté." });
        else {
            const included = contracts.map(c => ({ c, reason: includedReason(c, row.description) })).filter(item => item.reason);
            if (included.length) reviews.push({ row, contractIds: included.map(i => i.c.id), reason: included[0].reason! });
        }
    }
    const summaries: ContractPayments[] = contracts.map(c => {
        const history = grouped.get(c.id)!.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
        const period = history.filter(r => r.date >= from && r.date <= to);
        const positive = history.filter(r => r.outflowCents > 0), latest = positive[0] ?? null;
        const recent = positive.slice(0, 2);
        const repeated = recent.length === 2 && recent[0].outflowCents === recent[1].outflowCents && recent[0].accountId === recent[1].accountId && new Set(recent.map(r => r.date.slice(0, 7))).size === 2 && Number(new Date(recent[0].date)) - Number(new Date(recent[1].date)) >= 20 * 86400000 && Number(new Date(recent[0].date)) - Number(new Date(recent[1].date)) <= 40 * 86400000 && recent.every(r => positive.filter(p => p.date.slice(0, 7) === r.date.slice(0, 7)).length === 1);
        const invoiceMatches = c.billing?.amount === null || !c.billing?.asOf ? [] : history.filter(r => r.outflowCents === Math.round(c.billing!.amount! * 100) && r.date >= c.billing!.asOf && Number(new Date(r.date)) - Number(new Date(c.billing!.asOf)) <= 45 * 86400000);
        return { contractId: c.id, rows: period, history, cents: period.length ? period.reduce((n, r) => n + r.outflowCents, 0) : null, latest, repeated, invoiceMatch: invoiceMatches.length === 1 ? invoiceMatches[0] : null, referenceMonthly: contractTaxes(c) === true ? contractMonthly(c) : null };
    });
    const totals: Record<string, { cents: number; matched: number; unmatched: number }> = {};
    for (const c of contracts) { const s = summaries.find(s => s.contractId === c.id)!; const total = totals[c.billing?.currency ?? "CAD"] ??= { cents: 0, matched: 0, unmatched: 0 }; if (s.cents === null) total.unmatched++; else { total.cents += s.cents; total.matched++; } }
    const months = monthRange(from, to).map(month => ({ month, full: Boolean(state?.data && fullObservedMonth(state.data, month, from, to)), totals: summaries.flatMap(s => s.rows).filter(r => r.date.startsWith(month)).reduce<Record<string, number>>((t, r) => { t[r.currency] = (t[r.currency] ?? 0) + r.outflowCents; return t; }, {}) }));
    return { summaries, totals, months, reviews: reviews.filter(r => r.row.date >= from && r.row.date <= to) };
}
