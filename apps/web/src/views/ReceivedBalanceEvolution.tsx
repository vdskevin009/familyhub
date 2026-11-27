import { useId, useMemo, useState } from "react";
import type { FinanceBalanceObservation } from "../../../worker/src/finance-model";
import { receivedBalanceEvolution } from "../finance-balance-evolution";
import { displayFinanceCapture } from "./FinanceCollectionNote";
const money = (value: number, currency: string) => new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(value / 100);
const signedMoney = (value: number, currency: string) => (value > 0 ? "+" : "") + money(value, currency);
export default function ReceivedBalanceEvolution({ observations, accountId, currency }: { observations: FinanceBalanceObservation[]; accountId: string; currency: string }) {
    const evolution = useMemo(() => receivedBalanceEvolution(observations, accountId, currency), [observations, accountId, currency]);
    const [shown, setShown] = useState(20), titleId = useId(), descriptionId = useId();
    const points = evolution.points, chart = points.slice(-100), first = points[0], last = points.at(-1);
    const minimum = chart.length ? Math.min(...chart.map(p => p.balanceCents)) : 0, maximum = chart.length ? Math.max(...chart.map(p => p.balanceCents)) : 0;
    return <section className="finance-received-evolution" aria-labelledby={titleId}>
        <h3 id={titleId}>Received balance history</h3>
        {evolution.conflicting ? <p>Conflicting records prevent comparison. Check the sources.</p> : evolution.changeCents !== null && first && last ? <>
            <p className="finance-received-change">Change between the first and last comparable records: <strong>{signedMoney(evolution.changeCents, currency)}</strong></p>
            <p className="muted">From {displayFinanceCapture(first.capturedAt)} to {displayFinanceCapture(last.capturedAt)}. This change is not a return on investment. Contributions, withdrawals and other transactions can affect it.</p>
            <figure className="finance-received-chart">
                <div className="finance-received-scale"><small>Highest balance received: {money(maximum, currency)}</small><small>Lowest balance received: {money(minimum, currency)}</small></div>
                <svg viewBox="0 0 480 180" role="img" aria-labelledby={titleId} aria-describedby={descriptionId}>
                    <desc id={descriptionId}>{chart.length} balances plotted by date and amount. Exact amounts and dates follow.</desc>
                    <line x1="12" x2="468" y1="164" y2="164" className="finance-received-axis" />
                    {chart.map(p => <circle key={p.timestamp} data-received-point={p.capturedAt} cx={12 + (p.timestamp - chart[0].timestamp) / (chart.at(-1)!.timestamp - chart[0].timestamp) * 456} cy={maximum === minimum ? 88 : 148 - (p.balanceCents - minimum) / (maximum - minimum) * 128} r="5"><title>{money(p.balanceCents, currency)} · Received on {displayFinanceCapture(p.capturedAt)}</title></circle>)}
                </svg>
                <div className="finance-received-extent"><time dateTime={chart[0].capturedAt}>{displayFinanceCapture(chart[0].capturedAt)}</time><time dateTime={chart.at(-1)!.capturedAt}>{displayFinanceCapture(chart.at(-1)!.capturedAt)}</time></div>
                <figcaption>{chart.length < points.length ? "The 100 most recent records. " : ""}Only observed data points are shown. Dates are when the data was received, not when the bank updated its records.</figcaption>
            </figure>
        </> : <p>{points.length === 1 ? "Only one dated balance was received. A comparison will be available once a second balance is received." : "No comparable dated balances were received for this account."}</p>}
        {evolution.excluded > 0 && <p>{evolution.excluded} non-comparable record(s) excluded. Check currency, date, amount or source. No currency conversion was applied.</p>}
        <ol className="finance-received-history" aria-label="Received balances, newest to oldest">
            {[...points].reverse().slice(0, shown).map(p => <li key={p.timestamp} data-balance-received-at={p.capturedAt}>
                <div><strong>{money(p.balanceCents, currency)}</strong><span>Received on <time dateTime={p.capturedAt}>{displayFinanceCapture(p.capturedAt)}</time></span></div>
                <small>{p.sourceAsOf ? "Bank date: " + p.sourceAsOf : "Bank date unknown"}</small>
                {!evolution.conflicting && p.changeCents !== null && <small>Since the previous comparable balance: {signedMoney(p.changeCents, currency)}</small>}
            </li>)}
        </ol>
        {shown < points.length && <button className="button secondary" type="button" onClick={() => setShown(n => n + 20)}>View earlier balances ({points.length - shown})</button>}
    </section>;
}
