import { useMemo, useRef, useState } from "react";
import { expenseCategories, type ExpenseCategory, type FinanceState } from "../../../worker/src/finance-model";
import { baselineWindowMonths, shiftMonth, type SpendingTrend } from "../finance-trends";
import { Sheet } from "../ui/primitives";
import { useFinanceDialogHistory } from "../use-finance-dialog-history";
import { attributeSpendingDifference, leadingSpendingDifferences } from "../finance-trend-attribution";
import { displayFinanceCapture, FinanceCollectionNote } from "./FinanceCollectionNote";
import InfoPopover from "../ui/InfoPopover";
import "../finance-trends.css";

const money = (cents: number | null, currency: string) => cents === null ? "Non disponible" : new Intl.NumberFormat("fr-CA", { style: "currency", currency }).format(cents / 100);
const monthName = (month: string, short = false) => new Date(month + "-15T12:00:00Z").toLocaleDateString("fr-CA", { month: short ? "short" : "long", ...(short ? {} : { year: "numeric" }) });

/** Signed observed amounts on a common annual scale, never a goal or progress ring. */
export function Gauge({ actual, baseline, scale }: { actual: number | null; baseline: number | null; scale?: number }) {
    const maximum = Math.max(1, scale ?? Math.max(Math.abs(actual ?? 0), Math.abs(baseline ?? 0)));
    const position = (value: number) => 60 + Math.max(-1, Math.min(1, value / maximum)) * 55;
    return <svg className="trend-history-bars" viewBox="0 0 120 42" aria-hidden="true">
        <line x1="5" x2="115" y1="21" y2="21" stroke="var(--line)" />
        <line x1="60" x2="60" y1="2" y2="36" stroke="var(--muted)" />
        {actual !== null && actual !== 0 && <rect className="trend-observed-bar" x={Math.min(60, position(actual))} y="5" width={Math.max(1, Math.abs(position(actual) - 60))} height="10" rx="2" fill="var(--green)" />}
        {baseline !== null && baseline !== 0 && <rect className="trend-history-bar" x={Math.min(60, position(baseline))} y="26" width={Math.max(1, Math.abs(position(baseline) - 60))} height="7" rx="1" fill="none" stroke="var(--muted)" strokeDasharray="3 2" />}
        <text x="60" y="42" textAnchor="middle" fill="var(--muted)" fontSize="7">0</text>
    </svg>;
}

export function DailyCurve({ trend, currency }: { trend: Pick<SpendingTrend, "daily" | "elapsedDays" | "baselineReady">; currency: string }) {
    const values = trend.daily.flatMap(d => [d.actualCents, d.baselineCents]).filter((v): v is number => v !== null);
    if (!values.length) return <p>Aucun cumul disponible pour ce mois.</p>;
    const low = Math.min(0, ...values), high = Math.max(1, ...values), height = 160, width = 360;
    const y = (v: number) => 10 + height - (v - low) / (high - low) * height;
    const x = (day: number) => 8 + (day - 1) / Math.max(1, trend.daily.length - 1) * (width - 16);
    const points = (key: "actualCents" | "baselineCents") => trend.daily.filter(d => d[key] !== null).map(d => ({ x: x(d.day), y: y(d[key]!) }));
    const actual = points("actualCents"), baseline = points("baselineCents");
    const path = (points: { x: number; y: number }[]) => points.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ");
    return <>
        <figure className="trend-curve">
            <div className="trend-plot">
                <div className="trend-y-labels"><span>{money(high, currency)}</span><span>{money((high + low) / 2, currency)}</span><span>{money(low, currency)}</span></div>
                <svg viewBox="0 0 360 180" preserveAspectRatio="none" role="img" aria-label="Cumul quotidien observé et référence. Toutes les valeurs sont disponibles dans le tableau ci-dessous.">
                    {[low, (high + low) / 2, high].map(v => <line key={v} x1="8" x2="352" y1={y(v)} y2={y(v)} stroke="var(--line)" />)}
                    {baseline.length > 0 && <path d={path(baseline)} fill="none" stroke="var(--muted)" strokeWidth="2" strokeDasharray="6 4" />}
                    {actual.length > 0 && <><path d={path(actual)} fill="none" stroke="var(--green)" strokeWidth="3" /><circle cx={actual.at(-1)!.x} cy={actual.at(-1)!.y} r="4" fill="var(--green)" /></>}
                </svg>
            </div>
            <div className="trend-x-labels"><span>Jour 1</span><span>Jour {Math.ceil(trend.daily.length / 2)}</span><span>Jour {trend.daily.length}</span></div>
            <figcaption className="trend-legend"><span className="trend-key actual">Observé</span><span className="trend-key typical">Référence {trend.baselineReady ? "observée" : "indisponible"}</span></figcaption>
        </figure>
        <details><summary>Valeurs jour par jour</summary><table className="trend-table"><caption>Cumul des dépenses, remboursements déduits</caption><thead><tr><th>Jour</th><th>Observé</th><th>Référence</th></tr></thead><tbody>{trend.daily.map(d => <tr key={d.day}><th>{d.day}</th><td>{d.actualCents === null && d.day > trend.elapsedDays ? "Mois terminé" : money(d.actualCents, currency)}</td><td>{money(d.baselineCents, currency)}</td></tr>)}</tbody></table></details>
    </>;
}

export default function FinanceTrends({ state, trend, account, currency, onMonth, onCategory, unresolvedCount = 0 }: {
    state: FinanceState; trend: SpendingTrend; account: string; currency: string;
    onMonth: (month: string) => void; onCategory: (category: ExpenseCategory) => void; unresolvedCount?: number;
}) {
    const [detail,setDetail] = useState(false), trigger = useRef<HTMLButtonElement>(null);
    const attribution = useMemo(()=>attributeSpendingDifference(trend),[trend]);
    const leaders = leadingSpendingDifferences(attribution);
    const signed = (cents:number)=>`${cents>0?"+":""}${money(cents,currency)}`;
    const collection = state.imports.at(-1)?.collection;
    const close = ()=>{setDetail(false);requestAnimationFrame(()=>trigger.current?.focus());};
    useFinanceDialogHistory(detail,close);
    const openMonth = (month:string)=>{if(/^\d{4}-(0[1-9]|1[0-2])$/.test(month))onMonth(month);};
    const method = <div className="view-stack trend-method">
        <p>{trend.from} au {trend.to}{trend.partial ? ` · ${trend.elapsedDays} premiers jours` : ""}. {trend.referenceIndicative ? "Référence indicative." : ""}</p>
        <p>La référence est la moyenne des périodes observées parmi les {baselineWindowMonths} mois précédents, sans le mois cible ni les mois encore incomplets. Pour un mois partiel, les mêmes {trend.elapsedDays} premières journées sont retenues. Les mois absents sont exclus, jamais remplacés par zéro. Aucune extrapolation.</p>
        <p>Les bornes des mouvements ne prouvent pas un historique exhaustif. Les comptes incomplets ne sont pas supposés nuls. Un écart favorable n'est pas une économie garantie.</p>
        <p>Transferts, paiements de carte, placements, doublons confirmés et natures à vérifier restent exclus. Les remboursements conservent leur signe. {trend.summary.included.filter(r=>!r.reviewed).length} classifications restent suggérées.</p>
        {unresolvedCount>0 && <p>{unresolvedCount} opérations source sans rapprochement vérifié dans ce périmètre restent hors sous-total. Retrouvez-les dans Dépenses.</p>}
        <FinanceCollectionNote state={state}/>
        <details><summary>Méthode et couverture des sources</summary>
            <ul>{trend.candidates.map(c=><li key={c.month}>{c.month} : {c.reasons.length ? c.reasons.join("; ") : `admissible, comparaison du ${c.from} au ${c.comparisonTo}`}</li>)}</ul>
            <ul>{trend.coverage.map(c=><li key={c.account}><strong>{c.account}</strong>{c.rows.length ? c.rows.map((r,i)=><p key={i}>{r.earliest ?? "Début inconnu"} au {r.latest ?? "Fin inconnue"}{r.warning ? ` · ${r.warning}` : ""}</p>) : <p>Bornes absentes</p>}</li>)}</ul>
            {!!state.data?.limits.length && <details><summary>Notes de préparation des sources</summary><ul>{state.data.limits.map((limit,i)=><li key={i}>{limit}</li>)}</ul></details>}
            {trend.pendingCount>0 && <p>{trend.pendingCount} élément(s) en attente dans l'import complet, hors dépenses. {trend.pendingRows.length ? `${trend.pendingRows.length} dans la sélection.` : "Leurs dates et comptes ne sont pas disponibles pour cette sélection."}</p>}
        </details>
    </div>;
    return <div className="finance-trends view-stack">
        <div className="trend-month-navigation" aria-label="Navigation mensuelle">
            <button type="button" className="icon-button" aria-label="Mois analysé précédent" onClick={()=>openMonth(shiftMonth(trend.month,-1))}>‹</button>
            {[-2,-1,0,1].map(offset=>{const month=shiftMonth(trend.month,offset);return <button type="button" key={month} data-trend-month={month} className={month===trend.month?"selected":""} aria-current={month===trend.month?"date":undefined} aria-label={monthName(month)} onClick={()=>openMonth(month)}>{monthName(month,true)}</button>;})}
            <button type="button" className="icon-button" aria-label="Mois analysé suivant" onClick={()=>openMonth(shiftMonth(trend.month,1))}>›</button>
        </div>
        <div className="compact-heading trend-period-heading"><h2 id="trends-month-title" tabIndex={-1}>{monthName(trend.month)}</h2><label><span className="sr-only">Mois analysé</span><input type="month" aria-label="Mois analysé" value={trend.month} onChange={e=>openMonth(e.target.value)}/></label></div>
        <section className="surface view-stack trend-overview" aria-label="Résumé du mois">
            <div className="trend-headline"><span>Dépenses nettes · {currency}</span><strong className="trend-total" data-trend-actual={trend.actualCents ?? "unknown"}>{money(trend.actualCents,currency)}</strong>
                {attribution.available ? <button type="button" ref={trigger} className={`trend-difference ${attribution.displayDifferenceCents!<0?"favorable":attribution.displayDifferenceCents!>0?"higher":"equal"}`} data-trend-delta={attribution.displayDifferenceCents} aria-haspopup="dialog" aria-expanded={detail} onClick={()=>setDetail(true)}>{signed(attribution.displayDifferenceCents!)} vs référence <span aria-hidden="true">›</span></button> : <p className="trend-no-reference">{attribution.unavailableReason==="observed-unavailable" ? "Écart non établi : montant observé indisponible." : attribution.unavailableReason==="inconsistent-categories" ? "Détail de l'écart non établi." : "Référence indisponible"}</p>}
                <p className="trend-reference-status" role="status">{trend.baselineReady ? `${trend.referenceIndicative ? "Référence indicative" : "Référence observée"} : ${money(trend.baselineCents,currency)} · même période` : "Aucun montant de référence supposé."}{trend.partial ? ` · ${trend.elapsedDays} premiers jours` : ""}</p>
            </div>
            <DailyCurve trend={trend} currency={currency}/>
        </section>
        <section className="surface view-stack trend-explanation" aria-label="Explication de l'écart"><h2>Ce qui explique l'écart</h2>
            {attribution.available ? <ul>{leaders.map(c=><li key={c.key}><button type="button" className="trend-category" data-trend-leading={c.key} onClick={()=>c.categoryKeys.length===1 ? onCategory(c.categoryKeys[0] as ExpenseCategory) : setDetail(true)}><span>{c.label}</span><strong className={c.displayDifferenceCents<0?"favorable":"higher"}>{signed(c.displayDifferenceCents)}</strong></button></li>)}</ul> : <p>Les différences par catégorie apparaîtront lorsqu'une référence comparable sera disponible. Le montant observé reste affiché sans économie supposée.</p>}
        </section>
        <div className="trend-collection compact-heading"><small>{collection ? <>Collecté le <time dateTime={collection.retrievedAt}>{displayFinanceCapture(collection.retrievedAt)}</time></> : "Date de collecte non disponible"}{unresolvedCount>0 ? ` · ${unresolvedCount} opérations à rapprocher` : ""}</small><InfoPopover title="Lecture des tendances">{method}</InfoPopover></div>
        <Sheet open={detail} onClose={close} title="Écart à la référence" wide className="trend-attribution-dialog">
            <div className="view-stack"><p>{monthName(trend.month)} · {account ? state.data?.accounts.find(a=>a.id===account)?.name ?? "Compte sélectionné" : "Tous les comptes"} · {currency}</p>
                <strong className={`trend-attribution-total ${attribution.displayDifferenceCents!==null&&attribution.displayDifferenceCents<0?"favorable":"higher"}`}>{attribution.displayDifferenceCents===null ? "Non établi" : signed(attribution.displayDifferenceCents)}</strong>
                <p>{money(trend.actualCents,currency)} observés / {money(trend.baselineCents,currency)} de référence. {trend.referenceIndicative ? "Référence indicative." : ""}</p>
                <h3>Où ça a changé</h3><p className="trend-axis-legend">Moins ← 0 → Plus</p>
                <ul className="trend-attribution-list">{attribution.categories.map(c=>{const width=Math.abs(c.displayDifferenceCents)/attribution.scaleCents!*50;return <li key={c.key}><button type="button" data-trend-category={c.key} data-difference-cents={c.displayDifferenceCents} aria-label={`${c.label} : écart ${signed(c.displayDifferenceCents)}. Observé ${money(c.actualCents,currency)}, référence ${money(c.displayBaselineCents,currency)}. Voir les opérations.`} onClick={()=>onCategory(c.key as ExpenseCategory)}><span><strong>{expenseCategories[c.key as ExpenseCategory] ?? c.label}</strong><small>{money(c.actualCents,currency)} observés</small></span><span><span className="trend-attribution-track" aria-hidden="true"><span className={c.displayDifferenceCents<0?"favorable":"higher"} style={{left:`${c.displayDifferenceCents<0?50-width:50}%`,width:`${width}%`}}/></span><strong className={c.displayDifferenceCents<0?"favorable":"higher"}>{signed(c.displayDifferenceCents)}</strong></span></button></li>;})}</ul>
                <p>Toutes les catégories sont incluses : leurs écarts affichés expliquent le total. Un écart favorable n'est pas une économie garantie.</p>
                <button type="button" className="button secondary" onClick={close}>Fermer le détail de l'écart</button>
            </div>
        </Sheet>
    </div>;
}
