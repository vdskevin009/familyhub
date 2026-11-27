import type { SavingsContract } from "../savings";
import type { ContractPayments, PaidRow, reconcilePayments } from "../savings-payments";
import { calendarPeriod, periodMode, rangeLabel, type DateRange } from "../finance-periods";
import { recurringPaidTotals, recurringPaidCategories, recurringCategories } from "../recurring-presentation";
import InfoPopover from "../ui/InfoPopover";
const money = (cents: number, currency: string) => new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(cents / 100);
function PaymentSource({ row }: { row: PaidRow }) {
    return <details className="finance-evidence"><summary>Payment source</summary>{row.sources.map((s, i) => <p key={i}>{s.name}{s.record ? ` · line ${s.record}` : ""}{s.page ? ` · page ${s.page}` : ""}{s.sha256 && <code>SHA-256: {s.sha256}</code>}</p>)}</details>;
}
export function ContractPaymentDetails({ contract, summary }: { contract: SavingsContract; summary: ContractPayments }) {
    return <section className="paid-contract-details"><h3>Payments</h3><div className="view-stack">
        {!summary.rows.length && <p>No matched payment in this period. This does not mean spending was zero.</p>}
        {summary.rows.map(row=><div className="recurring-payment-row" key={row.id}><strong>{row.date} · {money(row.outflowCents,row.currency)}</strong><small>{row.outflowCents<0 ? "Refund deducted" : "Matched payment"}</small><PaymentSource row={row}/></div>)}
        <details><summary>History and matching ({summary.history.length})</summary><div className="view-stack">
        <p>Payments are grouped by provider name. This does not establish a policy number or historical service package. Saved classifications in Finances take precedence.</p>
        {summary.latest && <p>Last observed charge: <strong>{money(summary.latest.outflowCents, summary.latest.currency)}</strong> on {summary.latest.date}. {summary.repeated ? "Same amount in two consecutive months. Future price not guaranteed." : "This amount is not treated as a stable monthly price."}</p>}
        {summary.invoiceMatch && <p>The source amount dated {contract.billing?.asOf} matches the debit on {summary.invoiceMatch.date}. Equal amounts do not independently match an invoice. Check the originals.</p>}
        {summary.referenceMonthly != null && <p>Saved tax-inclusive reference: {money(Math.round(summary.referenceMonthly * 100), contract.billing?.currency ?? "CAD")}/month, normalized from the billed interval only. This is neither a payment for this period nor a forecast.</p>}
        {summary.history.map(row=><div key={row.id}><strong>{row.date} · {money(row.outflowCents,row.currency)}</strong><p>{row.description}{row.outflowCents<0 ? " · refund deducted" : ""}</p><PaymentSource row={row}/></div>)}
        </div></details>
    </div></section>;
}
export default function SavingsPayments({ result, contracts, range, onMonth, loading = false }: { result: ReturnType<typeof reconcilePayments>; contracts: SavingsContract[]; range: DateRange; onMonth: (range: DateRange) => void; loading?: boolean }) {
    const ids = new Set(contracts.map(c => c.id));
    const summaries = result.summaries.filter(s => ids.has(s.contractId));
    const totals = recurringPaidTotals(contracts, summaries);
    const categories = recurringPaidCategories(contracts, summaries);
    return <section className="surface view-stack recurring-paid" aria-label="Payments during the period, tax included" aria-busy={loading}>
        <div className="compact-heading"><h2>{periodMode(range)==="month" ? "Paid this month" : "Paid during the period"}</h2><InfoPopover title="Payments in the period">
            <p>{rangeLabel(range)} · {contracts.length} contracts shown.</p>
            <p>Bank transaction dates, with refunds deducted. Invoice periods stay with the contracts. A delayed charge is not moved to a different month.</p>
            <p>Partial totals include tax and fees in the debit without calculating them separately. A contract without an identified payment is not treated as free.</p>
            {Object.entries(totals).map(([currency, t]) => <p key={currency}>{currency} : {t.matched} matched contracts, {t.missing} without identified payments.</p>)}
        </InfoPopover></div>
        {loading ? <p className="recurring-loading" role="status">Loading payments…</p> : <div className="finance-totals recurring-currency-groups">{Object.entries(totals).map(([currency, t]) => {
            const breakdown=categories[currency] ?? [];
            const max=Math.max(1,...breakdown.map(item=>Math.abs(item.cents)));
            return <div className="recurring-currency-group" key={currency} data-paid-currency={currency}>
                <div className="recurring-paid-summary">
                    <div className="recurring-paid-amount"><strong className={t.cents===null ? "recurring-unavailable" : ""}>{t.cents !== null ? money(t.cents, currency) : "Not available"}</strong><small>{currency} · {rangeLabel(range)}</small></div>
                    <span className={`recurring-coverage${t.missing ? " partial" : ""}`}>{t.matched}/{t.matched+t.missing} matched contracts{t.missing>0 ? " · partial" : ""}</span>
                    <span className="recurring-coverage-track" aria-hidden="true"><span style={{width:`${t.matched/(t.matched+t.missing)*100}%`}}/></span>
                    <small>{t.cents===null ? "No payments identified" : "Identified payments · refunds deducted"}</small>
                </div>
                {breakdown.length>0 && <div className="recurring-breakdown"><h3>By category</h3><ul>{breakdown.map(item=><li key={item.category} data-paid-category={item.category} className={item.cents<0 ? "recurring-refund" : ""}>
                    <div><span>{recurringCategories[item.category]}</span><strong>{money(item.cents,currency)}</strong></div>
                    <span className="recurring-category-track" aria-hidden="true"><span style={{width:`${Math.abs(item.cents)/max*100}%`}}/></span>
                    {item.cents<0 && <small>Net refund</small>}
                </li>)}</ul></div>}
            </div>;
        })}</div>}
        {!loading && !contracts.length && <p>No contracts match this filter. No total is available.</p>}
        {!loading && result.months.length > 1 && <details className="savings-months"><summary>View monthly payments</summary>{Object.keys(totals).map(currency => {
            const months = result.months.map(m => { const rows = summaries.flatMap(s => s.rows).filter(r => r.currency === currency && r.date.startsWith(m.month)); return { ...m, count: rows.length, cents: rows.reduce((n, r) => n + r.outflowCents, 0) }; });
            const max = Math.max(1, ...months.map(m => Math.abs(m.cents)));
            return <div key={currency}><h3>Month by month · {currency}</h3><ul className="finance-bars">{months.map(m => <li key={m.month}><button onClick={() => onMonth(calendarPeriod(Number(m.month.slice(0, 4)), Number(m.month.slice(5, 7))))}><span className="finance-bar-label"><span>{m.month}<small>{m.full ? "Entire observed period" : "Partial coverage"}</small></span><strong>{m.count ? money(m.cents, currency) : "No payments identified"}</strong></span><span className="finance-bar-track" aria-hidden="true"><span className={m.cents < 0 ? "negative" : ""} style={{ width: Math.abs(m.cents) / max * 100 + "%" }} /></span></button></li>)}</ul></div>;
        })}</details>}
    </section>;
}

export function PaymentObservations({ result, contracts, visibleContracts, onCategorize, onOpenContract }: {
    result: ReturnType<typeof reconcilePayments>; contracts: SavingsContract[]; visibleContracts: SavingsContract[];
    onCategorize: () => void; onOpenContract: (contract: SavingsContract) => void;
}) {
    const ids = new Set(visibleContracts.map(c => c.id));
    const reviews = result.reviews.filter(r => r.contractIds.some(id => ids.has(id))).sort((a, b) => b.row.date.localeCompare(a.row.date));
    if (!reviews.length) return null;
    return <section className="surface view-stack savings-observations" aria-label="Payment observations">
        <div className="compact-heading"><h2>Payments to review</h2><InfoPopover title="Payments to review"><p>Even a matched payment may need a contract review. Check the service, activation, effective dates and extras before estimating savings.</p></InfoPopover></div>
        <details className="payment-reviews"><summary>{reviews.length} payment{reviews.length === 1 ? "" : "s"} to review{reviews.every(r => !r.matchedContractId) && " · excluded from matched totals"}</summary><div className="view-stack">
            {reviews.map(({ row, contractIds, reason, matchedContractId }) => <div key={row.id}>
                <strong>{row.date} · {money(row.outflowCents, row.currency)}</strong>
                <p>{row.description}</p>
                <p>{matchedContractId ? "Payment matched to its subscription and allocated to that contract." : "Unallocated amount, excluded from matched totals."}</p>
                <p>{reason}</p>
                {contracts.filter(c => contractIds.includes(c.id)).map(c =>
                    <button type="button" className="button secondary" key={c.id} onClick={() => onOpenContract(c)}>View contract {c.name}</button>)}
                <PaymentSource row={row} />
            </div>)}
        </div></details>
        {reviews.some(r => !r.matchedContractId) && <button className="button secondary" onClick={onCategorize}>Categorize in Finances</button>}
    </section>;
}
