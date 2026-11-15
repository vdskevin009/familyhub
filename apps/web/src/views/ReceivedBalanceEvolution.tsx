import { useId, useMemo, useState } from "react";
import type { FinanceBalanceObservation } from "../../../worker/src/finance-model";
import { receivedBalanceEvolution } from "../finance-balance-evolution";
import { displayFinanceCapture } from "./FinanceCollectionNote";
const money = (value: number, currency: string) => new Intl.NumberFormat("fr-CA", { style: "currency", currency }).format(value / 100);
const signedMoney = (value: number, currency: string) => (value > 0 ? "+" : "") + money(value, currency);
export default function ReceivedBalanceEvolution({ observations, accountId, currency }: { observations: FinanceBalanceObservation[]; accountId: string; currency: string }) {
    const evolution = useMemo(() => receivedBalanceEvolution(observations, accountId, currency), [observations, accountId, currency]);
    const [shown, setShown] = useState(20), titleId = useId(), descriptionId = useId();
    const points = evolution.points, chart = points.slice(-100), first = points[0], last = points.at(-1);
    const minimum = chart.length ? Math.min(...chart.map(p => p.balanceCents)) : 0, maximum = chart.length ? Math.max(...chart.map(p => p.balanceCents)) : 0;
    return <section className="finance-received-evolution" aria-labelledby={titleId}>
        <h3 id={titleId}>Évolution des soldes reçus</h3>
        {evolution.conflicting ? <p>Des réceptions contradictoires empêchent le calcul de l’évolution. Vérifiez les sources.</p> : evolution.changeCents !== null && first && last ? <>
            <p className="finance-received-change">Écart entre la première et la dernière réception comparable : <strong>{signedMoney(evolution.changeCents, currency)}</strong></p>
            <p className="muted">Du {displayFinanceCapture(first.capturedAt)} au {displayFinanceCapture(last.capturedAt)}. Cet écart n’est pas un rendement : versements, retraits et autres mouvements peuvent y contribuer.</p>
            <figure className="finance-received-chart">
                <div className="finance-received-scale"><small>Maximum reçu : {money(maximum, currency)}</small><small>Minimum reçu : {money(minimum, currency)}</small></div>
                <svg viewBox="0 0 480 180" role="img" aria-labelledby={titleId} aria-describedby={descriptionId}>
                    <desc id={descriptionId}>{chart.length} réceptions réelles, placées selon leur date et leur montant. Montants et dates exacts dans la liste qui suit.</desc>
                    <line x1="12" x2="468" y1="164" y2="164" className="finance-received-axis" />
                    {chart.map(p => <circle key={p.timestamp} data-received-point={p.capturedAt} cx={12 + (p.timestamp - chart[0].timestamp) / (chart.at(-1)!.timestamp - chart[0].timestamp) * 456} cy={maximum === minimum ? 88 : 148 - (p.balanceCents - minimum) / (maximum - minimum) * 128} r="5"><title>{money(p.balanceCents, currency)} · Reçu le {displayFinanceCapture(p.capturedAt)}</title></circle>)}
                </svg>
                <div className="finance-received-extent"><time dateTime={chart[0].capturedAt}>{displayFinanceCapture(chart[0].capturedAt)}</time><time dateTime={chart.at(-1)!.capturedAt}>{displayFinanceCapture(chart.at(-1)!.capturedAt)}</time></div>
                <figcaption>{chart.length < points.length ? "Les 100 réceptions les plus récentes. " : ""}Points observés uniquement, sans valeur inventée entre les réceptions. Dates de réception, pas dates bancaires.</figcaption>
            </figure>
        </> : <p>{points.length === 1 ? "Une seule réception datée : l’évolution sera disponible après une autre réception réelle." : "Aucun solde reçu daté comparable pour ce compte."}</p>}
        {evolution.excluded > 0 && <p>{evolution.excluded} réception(s) non comparable(s) exclue(s) : devise, date, montant ou provenance à vérifier. Aucune conversion effectuée.</p>}
        <ol className="finance-received-history" aria-label="Réceptions de soldes, de la plus récente à la plus ancienne">
            {[...points].reverse().slice(0, shown).map(p => <li key={p.timestamp} data-balance-received-at={p.capturedAt}>
                <div><strong>{money(p.balanceCents, currency)}</strong><span>Reçu le <time dateTime={p.capturedAt}>{displayFinanceCapture(p.capturedAt)}</time></span></div>
                <small>{p.sourceAsOf ? "Date bancaire : " + p.sourceAsOf : "Date bancaire inconnue"}</small>
                {!evolution.conflicting && p.changeCents !== null && <small>Depuis la réception comparable précédente : {signedMoney(p.changeCents, currency)}</small>}
            </li>)}
        </ol>
        {shown < points.length && <button className="button secondary" type="button" onClick={() => setShown(n => n + 20)}>Voir les réceptions précédentes ({points.length - shown})</button>}
    </section>;
}
