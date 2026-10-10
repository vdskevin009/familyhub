import type { SavingsContract } from "../savings";
import type { ContractPayments, PaidRow, reconcilePayments } from "../savings-payments";
import { calendarPeriod, type DateRange } from "../finance-periods";
const money = (cents: number, currency: string) => new Intl.NumberFormat("fr-CA", { style: "currency", currency }).format(cents / 100);
function PaymentSource({ row }: { row: PaidRow }) {
    return <details className="finance-evidence"><summary>Source du paiement</summary>{row.sources.map((s, i) => <p key={i}>{s.name}{s.record ? ` · ligne ${s.record}` : ""}{s.page ? ` · page ${s.page}` : ""}{s.sha256 && <code>SHA-256 : {s.sha256}</code>}</p>)}</details>;
}
export function ContractPaymentDetails({ contract, summary }: { contract: SavingsContract; summary: ContractPayments }) {
    return <details className="paid-contract-details"><summary>Paiements et rapprochement ({summary.rows.length})</summary><div className="view-stack">
        <p>Regroupement proposé par libellé du fournisseur. Il ne prouve ni le numéro de police ni le forfait des anciens paiements. Les décisions de nature enregistrées dans Finances restent prioritaires.</p>
        {summary.latest && <p>Dernier débit observé : <strong>{money(summary.latest.outflowCents, summary.latest.currency)}</strong> le {summary.latest.date}. {summary.repeated ? "Même montant sur deux mois successifs; tarif futur non garanti." : "Le montant n’est pas retenu comme tarif mensuel stable."}</p>}
        {summary.invoiceMatch && <p>Le montant source daté du {contract.billing?.asOf} coïncide avec le prélèvement du {summary.invoiceMatch.date}. Cette égalité ne prouve pas un rapprochement de facture indépendant; vérifier les références originales.</p>}
        {summary.referenceMonthly != null && <p>Référence TTC enregistrée : {money(Math.round(summary.referenceMonthly * 100), contract.billing?.currency ?? "CAD")}/mois après normalisation du seul intervalle facturé. Ce n’est pas un paiement de cette période ni une prévision.</p>}
        {!summary.rows.length && <p>Aucun paiement rapproché dans cette période. Cela ne prouve pas une dépense nulle.</p>}
        {summary.rows.map(row => <div key={row.id}><strong>{row.date} · {money(row.outflowCents, row.currency)}</strong><p>{row.description}{row.outflowCents < 0 ? " · remboursement déduit" : ""}</p><PaymentSource row={row} /></div>)}
    </div></details>;
}
export default function SavingsPayments({ result, contracts, onMonth, onCategorize }: { result: ReturnType<typeof reconcilePayments>; contracts: SavingsContract[]; onMonth: (range: DateRange) => void; onCategorize: () => void }) {
    const ids = new Set(contracts.map(c => c.id));
    const summaries = result.summaries.filter(s => ids.has(s.contractId));
    const totals: Record<string, { cents: number; matched: number; missing: number }> = {};
    for (const c of contracts) { const s = summaries.find(s => s.contractId === c.id)!; const total = totals[c.billing?.currency ?? "CAD"] ??= { cents: 0, matched: 0, missing: 0 }; if (s.cents === null) total.missing++; else { total.cents += s.cents; total.matched++; } }
    const reviews = result.reviews.filter(r => r.contractIds.some(id => ids.has(id)));
    return <section className="surface view-stack" aria-label="Paiements TTC de la période">
        <h2>Payé sur la période</h2>
        <p>Dates des opérations bancaires, remboursements déduits. Les périodes des factures restent dans les contrats. Un prélèvement décalé n’est pas déplacé vers un autre mois.</p>
        <div className="finance-totals">{Object.entries(totals).map(([currency, t]) => <div key={currency}><small>Paiements rapprochés · {currency}</small><strong>{t.matched ? money(t.cents, currency) : "Non disponible"}</strong><small>{t.matched} contrat(s) rapproché(s) · {t.missing} sans paiement identifié. Totaux partiels, taxes/frais dans le débit sans calcul séparé.</small></div>)}</div>
        {result.months.length > 1 && Object.keys(totals).map(currency => {
            const months = result.months.map(m => { const rows = summaries.flatMap(s => s.rows).filter(r => r.currency === currency && r.date.startsWith(m.month)); return { ...m, count: rows.length, cents: rows.reduce((n, r) => n + r.outflowCents, 0) }; });
            const max = Math.max(1, ...months.map(m => Math.abs(m.cents)));
            return <div key={currency}><h3>Mois par mois · {currency}</h3><ul className="finance-bars">{months.map(m => <li key={m.month}><button onClick={() => onMonth(calendarPeriod(Number(m.month.slice(0, 4)), Number(m.month.slice(5, 7))))}><span className="finance-bar-label"><span>{m.month}<small>{m.full ? "Fenêtre observée entière" : "Couverture partielle"}</small></span><strong>{m.count ? money(m.cents, currency) : "Aucun paiement identifié"}</strong></span><span className="finance-bar-track" aria-hidden="true"><span className={m.cents < 0 ? "negative" : ""} style={{ width: Math.abs(m.cents) / max * 100 + "%" }} /></span></button></li>)}</ul></div>;
        })}
        {reviews.length > 0 && <details className="payment-reviews" open><summary>{reviews.length} paiement(s) à vérifier · exclus des totaux rapprochés</summary><div className="view-stack">{reviews.map(({ row, contractIds, reason }) => <div key={row.id}><strong>{row.date} · {money(row.outflowCents, row.currency)}</strong><p>{row.description}</p><p>{reason}</p><small>Contrat(s) concerné(s) : {contracts.filter(c => contractIds.includes(c.id)).map(c => c.name).join(", ")}</small><PaymentSource row={row} /></div>)}</div></details>}
        <button className="button secondary" onClick={onCategorize}>Catégoriser dans Finances</button>
    </section>;
}
