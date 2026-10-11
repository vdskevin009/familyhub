import { useMemo, useRef, useState } from "react";
import { expenseCategories, type ExpenseCategory, type FinanceState } from "../../../worker/src/finance-model";
import { baselineWindowMonths, minimumBaselineMonths, localToday, shiftMonth, spendingTrend, type SpendingTrend } from "../finance-trends";
import InfoPopover from "../ui/InfoPopover";
import "../finance-trends.css";

const money = (cents: number | null, currency: string) => cents === null ? "Non disponible" : new Intl.NumberFormat("fr-CA", { style: "currency", currency }).format(cents / 100);
const monthName = (month: string, short = false) => new Date(month + "-15T12:00:00Z").toLocaleDateString("fr-CA", { month: short ? "short" : "long", ...(short ? {} : { year: "numeric" }) });

/** Amounts, not a budget target. Actual observation never depends on a baseline. */
export function Gauge({ actual, baseline, scale }: { actual: number | null; baseline: number | null; scale?: number }) {
    const maximum = scale ?? Math.max(Math.abs(actual ?? 0), Math.abs(baseline ?? 0), 1);
    const length = (value: number) => Math.min(95, Math.abs(value) / Math.max(1, maximum) * 95);
    return <svg className="trend-gauge" viewBox="0 0 120 120" aria-hidden="true">
        {[46, 34].map(r => <circle key={r} cx="60" cy="60" r={r} fill="none" stroke="var(--line)" strokeWidth="7" />)}
        {actual !== null && actual !== 0 && <circle className="trend-actual-ring" cx="60" cy="60" r="46" fill="none" stroke="var(--green)" strokeWidth="7" pathLength="100" strokeDasharray={`${length(actual)} 100`} transform="rotate(-90 60 60)" />}
        {baseline !== null && baseline !== 0 && <circle className="trend-reference-ring" cx="60" cy="60" r="34" fill="none" stroke="var(--muted)" strokeWidth="5" pathLength="100" strokeDasharray={`${length(baseline)} 100`} transform="rotate(-90 60 60)" />}
        {actual === null && <text x="60" y="66" textAnchor="middle" fill="var(--muted)" fontSize="24">—</text>}
    </svg>;
}

function DailyCurve({ trend, currency }: { trend: SpendingTrend; currency: string }) {
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

export default function FinanceTrends({ state, trend, account, currency, onMonth, onCategory }: {
    state: FinanceState; trend: SpendingTrend; account: string; currency: string;
    onMonth: (month: string) => void; onCategory: (category: ExpenseCategory) => void;
}) {
    const [category, setCategory] = useState("");
    const [detail, setDetail] = useState(false);
    const root = useRef<HTMLDivElement>(null);
    const today = localToday(), year = trend.month.slice(0, 4);
    const yearMonths = useMemo(() => Array.from({ length: 12 }, (_, i) => spendingTrend(state, `${year}-${String(i + 1).padStart(2, "0")}`, account, currency, today)), [state, year, account, currency, today]);
    const annualScale = Math.max(1, ...yearMonths.flatMap(m => [Math.abs(m.actualCents ?? 0), Math.abs(m.baselineCents ?? 0)]));
    const earliest = Number(state.data!.scope.from.slice(0, 4)), latest = Math.max(Number(today.slice(0, 4)), Number(state.data!.scope.to.slice(0, 4)), Number(year));
    const years = Array.from({ length: Math.min(50, latest - Math.min(earliest, Number(year)) + 1) }, (_, i) => latest - i);
    const categories = trend.categories.filter(c => !category || c.key === category).sort((a, b) => Math.abs(b.actualCents ?? b.baselineCents ?? 0) - Math.abs(a.actualCents ?? a.baselineCents ?? 0));
    const amounts = categories.flatMap(c => [c.actualCents, c.baselineCents]).filter((v): v is number => v !== null);
    const low = Math.min(0, ...amounts), high = Math.max(1, ...amounts), position = (v: number) => (v - low) / (high - low) * 300 + 5;
    const difference = trend.comparisonReady && trend.actualCents !== null && trend.baselineCents !== null ? trend.actualCents - trend.baselineCents : null;
    const focus = (selector: string) => requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(selector)?.focus());
    const openMonth = (month: string) => { onMonth(month); setDetail(true); setCategory(""); focus("#trends-month-title"); };
    const back = () => { setDetail(false); focus(`[data-trend-month="${trend.month}"]`); };
    const method = <div className="view-stack trend-method">
        <p>Le cercle extérieur montre le montant net observé, même sans comparaison. Le cercle intérieur montre la référence historique lorsqu’elle existe. Les douze mois partagent la même échelle. Un montant négatif signifie des remboursements nets; ce n'est pas une progression vers un budget.</p>
        <p>La référence est la moyenne d'au moins {minimumBaselineMonths} mois admissibles parmi les {baselineWindowMonths} précédents, sans le mois cible. Pour un mois partiel, les mêmes {trend.elapsedDays} premières journées sont retenues. Aucune extrapolation.</p>
        <p>Les bornes de mouvements ne prouvent pas un historique exhaustif. Un montant observé reste visible si la couverture actuelle empêche une comparaison. Aucun compte incomplet n'est supposé nul.</p>
        <p>Les paiements de carte, transferts, placements, doublons confirmés et natures à vérifier restent exclus. Les remboursements conservent leur signe. {trend.summary.included.filter(r => !r.reviewed).length} classifications sont encore suggérées dans ce mois.</p>
        <details><summary>Méthode et couverture des sources</summary>
            <ul>{trend.candidates.map(c => <li key={c.month}>{c.month} : {c.reasons.length ? c.reasons.join("; ") : `admissible, comparaison du ${c.from} au ${c.comparisonTo}`}</li>)}</ul>
            <ul>{trend.coverage.map(c => <li key={c.account}><strong>{c.account}</strong>{c.rows.length ? c.rows.map((r, i) => <p key={i}>{r.earliest ?? "Début inconnu"} au {r.latest ?? "Fin inconnue"}{r.warning ? ` · ${r.warning}` : ""}</p>) : <p>Bornes absentes</p>}</li>)}</ul>
            {!!state.data?.limits.length && <details><summary>Notes de préparation des sources</summary><p>Notes conservées à l'import; les décisions peuvent avoir changé depuis.</p><ul>{state.data.limits.map((limit, i) => <li key={i}>{limit}</li>)}</ul></details>}
        </details>
    </div>;
    return <div ref={root} className="finance-trends view-stack">
        {!detail ? <section className="surface view-stack trend-annual" aria-labelledby="trends-year-title">
            <div className="trend-heading"><h2 id="trends-year-title">Année</h2><div className="trend-controls"><label><select aria-label="Année analysée" value={year} onChange={e => onMonth(e.target.value + trend.month.slice(4))}>{years.map(y => <option key={y}>{y}</option>)}</select></label><InfoPopover title="Lecture des tendances">{method}</InfoPopover></div></div>
            <div className="trend-months">{yearMonths.map(m => <button type="button" data-trend-month={m.month} key={m.month} className={m.month === trend.month ? "selected" : ""} onClick={() => openMonth(m.month)} aria-label={`Ouvrir ${monthName(m.month)}. Observé : ${money(m.actualCents, currency)}. Référence : ${money(m.baselineCents, currency)}. ${m.future ? "Mois à venir" : !m.comparable ? "Comparaison indisponible" : m.partial ? "Mois partiel" : "Mois terminé"}`}>
                <strong>{monthName(m.month, true)}</strong><Gauge actual={m.actualCents} baseline={m.baselineCents} scale={annualScale} />
                <span>{m.actualCents === null ? "—" : money(m.actualCents, currency)}</span>
                <small>{m.future ? "À venir" : !m.available ? "Sans données" : m.actualCents === null ? "Bornes à vérifier" : m.actualCents < 0 ? "Net remboursé" : m.partial ? `Au ${Number(m.to.slice(8))}` : "Observé"}</small>
            </button>)}</div>
            <div className="trend-legend"><span className="trend-key actual">Observé</span><span className="trend-key typical">Référence historique</span></div>
        </section> : <>
            <div className="trend-detail-nav"><button type="button" className="button secondary" onClick={back}>Retour à l'année</button><InfoPopover title="Lecture des tendances">{method}</InfoPopover></div>
            <section className="surface view-stack" aria-labelledby="trends-month-title">
                <div className="trend-navigation"><button className="icon-button" aria-label="Mois analysé précédent" onClick={() => openMonth(shiftMonth(trend.month, -1))}>‹</button><h2 tabIndex={-1} id="trends-month-title">{monthName(trend.month)}</h2><button className="icon-button" aria-label="Mois analysé suivant" onClick={() => openMonth(shiftMonth(trend.month, 1))}>›</button></div>
                <div className="trend-headline"><Gauge actual={trend.actualCents} baseline={trend.baselineCents} /><div><small>Dépenses nettes · {currency}</small><p className="trend-total">{money(trend.actualCents, currency)}</p><p>Référence observée : <strong>{money(trend.baselineCents, currency)}</strong></p>{difference !== null && <p>{difference === 0 ? "Au niveau de la référence" : `${money(Math.abs(difference), currency)} ${difference > 0 ? "au-dessus" : "en dessous"} de la référence`}</p>}</div></div>
                <div className="compact-heading"><small>{trend.available ? `${trend.from} au ${trend.to}${trend.partial ? ` · ${trend.elapsedDays} premiers jours` : ""}` : "Aucune période disponible"}</small><InfoPopover title="Couverture de ce mois">
                    {!trend.comparable && <ul>{trend.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}
                    <p>{trend.baselineReady ? `Référence : ${trend.qualifiedMonths.join(", ")}. ${trend.partial ? `Moyenne des ${trend.elapsedDays} premiers jours de ces mois.` : "Moyenne de ces mois entiers."}` : `Historique insuffisant : ${trend.qualifiedMonths.length} mois admissible(s), au moins ${minimumBaselineMonths} requis.`}</p>
                    {!trend.comparisonReady && <p>La référence historique n'est pas une comparaison validée avec un mois dont les bornes sont à vérifier.</p>}
                </InfoPopover></div>
                {!trend.comparisonReady && <small className="trend-coverage" role="status">{!trend.comparable ? "Comparaison indisponible · bornes à vérifier" : "Historique insuffisant pour comparer"}</small>}
            </section>
            <section className="surface view-stack"><div className="trend-heading"><h2>Catégories</h2><details className="trend-category-filter"><summary>Filtrer</summary><label>Afficher une catégorie<select aria-label="Afficher une catégorie" value={category} onChange={e => setCategory(e.target.value)}><option value="">Toutes les catégories</option>{Object.entries(expenseCategories).filter(([key]) => key !== "savings-investments").map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></details></div>
                <div className="trend-categories">{categories.map(c => <button type="button" key={c.key} className="trend-category" onClick={() => onCategory(c.key)}>
                    <span className="trend-category-line"><strong>{c.label}</strong><b>{money(c.actualCents, currency)}</b></span>
                    <svg viewBox="0 0 310 26" preserveAspectRatio="none" aria-hidden="true"><line x1={position(0)} x2={position(0)} y1="0" y2="26" stroke="var(--muted)" />{c.actualCents !== null && <rect x={Math.min(position(0), position(c.actualCents))} y="2" width={Math.abs(position(c.actualCents) - position(0))} height="8" fill="var(--green)" />}{c.baselineCents !== null && <rect x={Math.min(position(0), position(c.baselineCents))} y="15" width={Math.abs(position(c.baselineCents) - position(0))} height="8" fill="none" stroke="var(--muted)" strokeDasharray="4 2" />}</svg>
                    <small>{c.count} opérations · Référence {money(c.baselineCents, currency)}</small>
                </button>)}</div>{!categories.length && <p>Aucune dépense pour ce filtre. Changez de catégorie ou de mois.</p>}
            </section>
            <details className="surface trend-daily"><summary>Cumul quotidien</summary><DailyCurve trend={trend} currency={currency} /></details>
            {(trend.pendingCount > 0 || trend.pendingRows.length > 0) && <details className="surface"><summary>Opérations en attente</summary>{trend.pendingCount > 0 && <p>{trend.pendingCount} élément(s) signalé(s) dans l'import complet, sans ventilation par mois ou compte.</p>}<p>Hors totaux. Le décompte global et les lignes ci-dessous ne s'additionnent pas.</p>{trend.pendingRows.length ? <ul>{trend.pendingRows.map(r => <li key={r.id}>{r.date} · {r.description} · {money(r.outflowCents, r.currency)}</li>)}</ul> : <p>Les dates et montants détaillés ne sont pas disponibles pour cette sélection.</p>}</details>}
        </>}
    </div>;
}
