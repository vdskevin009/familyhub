import { useMemo, useState } from "react";
import { expenseCategories, type ExpenseCategory, type FinanceState } from "../../../worker/src/finance-model";
import { baselineWindowMonths, minimumBaselineMonths, localToday, shiftMonth, spendingTrend, type SpendingTrend } from "../finance-trends";
import "../finance-trends.css";

const money = (cents: number | null, currency: string) => cents === null ? "Non disponible" : new Intl.NumberFormat("fr-CA", { style: "currency", currency }).format(cents / 100);
const monthName = (month: string, short = false) => new Date(month + "-15T12:00:00Z").toLocaleDateString("fr-CA", { month: short ? "short" : "long", ...(short ? {} : { year: "numeric" }) });

function Gauge({ actual, baseline }: { actual: number | null; baseline: number | null }) {
    const ready = actual !== null && baseline !== null && actual >= 0 && baseline >= 0 && Math.max(actual, baseline) > 0;
    const scale = Math.max(actual ?? 0, baseline ?? 0, 1) * 1.05;
    const arc = (value: number, radius: number) => {
        const angle = value / scale * Math.PI * 2;
        return `M60,${60 - radius} A${radius},${radius} 0 ${angle > Math.PI ? 1 : 0} 1 ${60 + Math.sin(angle) * radius},${60 - Math.cos(angle) * radius}`;
    };
    return <svg className="trend-gauge" viewBox="0 0 120 120" aria-hidden="true">
        {[46, 34].map(r => <circle key={r} cx="60" cy="60" r={r} fill="none" stroke="var(--line)" strokeWidth="7" />)}
        {ready && <g>
            {actual! > 0 && <path d={arc(actual!, 46)} fill="none" stroke="var(--green)" strokeWidth="7" />}
            {baseline! > 0 && <path d={arc(baseline!, 34)} fill="none" stroke="var(--muted)" strokeWidth="5" strokeDasharray="6 4" />}
        </g>}
        {!ready && <text x="60" y="66" textAnchor="middle" fill="var(--muted)" fontSize="24">—</text>}
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
                <svg viewBox="0 0 360 180" preserveAspectRatio="none" role="img" aria-label="Cumul quotidien observé et habituel. Toutes les valeurs sont disponibles dans le tableau ci-dessous.">
                    {[low, (high + low) / 2, high].map(v => <line key={v} x1="8" x2="352" y1={y(v)} y2={y(v)} stroke="var(--line)" />)}
                    {baseline.length > 0 && <path d={path(baseline)} fill="none" stroke="var(--muted)" strokeWidth="2" strokeDasharray="6 4" />}
                    {actual.length > 0 && <><path d={path(actual)} fill="none" stroke="var(--green)" strokeWidth="3" /><circle cx={actual.at(-1)!.x} cy={actual.at(-1)!.y} r="4" fill="var(--green)" /></>}
                </svg>
            </div>
            <div className="trend-x-labels"><span>Jour 1</span><span>Jour {Math.ceil(trend.daily.length / 2)}</span><span>Jour {trend.daily.length}</span></div>
            <figcaption className="trend-legend"><span className="trend-key actual">Observé</span><span className="trend-key typical">Habituel {trend.baselineReady ? "observé" : "indisponible"}</span></figcaption>
        </figure>
        <details><summary>Valeurs jour par jour</summary><table className="trend-table"><caption>Cumul des dépenses, remboursements déduits</caption><thead><tr><th>Jour</th><th>Observé</th><th>Habituel</th></tr></thead><tbody>{trend.daily.map(d => <tr key={d.day}><th>{d.day}</th><td>{d.actualCents === null && d.day > trend.elapsedDays ? "Mois terminé" : money(d.actualCents, currency)}</td><td>{money(d.baselineCents, currency)}</td></tr>)}</tbody></table></details>
    </>;
}

export default function FinanceTrends({ state, trend, account, currency, onMonth, onCategory }: {
    state: FinanceState; trend: SpendingTrend; account: string; currency: string;
    onMonth: (month: string) => void; onCategory: (category: ExpenseCategory) => void;
}) {
    const [category, setCategory] = useState("");
    const today = localToday(), year = trend.month.slice(0, 4);
    const yearMonths = useMemo(() => Array.from({ length: 12 }, (_, i) => spendingTrend(state, `${year}-${String(i + 1).padStart(2, "0")}`, account, currency, today)), [state, year, account, currency, today]);
    const earliest = Number(state.data!.scope.from.slice(0, 4)), latest = Math.max(Number(today.slice(0, 4)), Number(state.data!.scope.to.slice(0, 4)), Number(year));
    const years = Array.from({ length: Math.min(50, latest - Math.min(earliest, Number(year)) + 1) }, (_, i) => latest - i);
    const categories = trend.categories.filter(c => !category || c.key === category).sort((a, b) => Math.abs(b.actualCents ?? b.baselineCents ?? 0) - Math.abs(a.actualCents ?? a.baselineCents ?? 0));
    const amounts = categories.flatMap(c => [c.actualCents, c.baselineCents]).filter((v): v is number => v !== null);
    const low = Math.min(0, ...amounts), high = Math.max(1, ...amounts), position = (v: number) => (v - low) / (high - low) * 300 + 5;
    const difference = trend.actualCents !== null && trend.baselineCents !== null ? trend.actualCents - trend.baselineCents : null;
    return <div className="finance-trends view-stack">
        <section className="surface view-stack" aria-labelledby="trends-year-title">
            <div className="trend-heading"><h2 id="trends-year-title">Votre année en dépenses</h2><label>Année analysée<select aria-label="Année analysée" value={year} onChange={e => onMonth(e.target.value + trend.month.slice(4))}>{years.map(y => <option key={y}>{y}</option>)}</select></label></div>
            <p>Les repères viennent de votre historique importé. Ce sont des moyennes observées, pas des objectifs.</p>
            <p className="muted">Chaque jauge compare son mois à son propre historique. Les montants permettent de comparer les mois entre eux.</p>
            <p className="trend-legend"><span className="trend-key actual">Observé</span><span className="trend-key typical">Habituel</span></p>
            <div className="trend-months">{yearMonths.map(m => <button key={m.month} className={m.month === trend.month ? "selected" : ""} aria-pressed={m.month === trend.month} onClick={() => onMonth(m.month)} aria-label={`${monthName(m.month)}. Observé : ${money(m.actualCents, currency)}. Habituel : ${money(m.baselineCents, currency)}. ${m.future ? "Mois à venir" : !m.comparable ? "Couverture insuffisante" : m.partial ? "Mois partiel" : "Mois terminé"}`}>
                <strong>{monthName(m.month, true)}</strong><Gauge actual={m.actualCents} baseline={m.baselineCents} />
                <span>{m.actualCents === null ? "—" : money(m.actualCents, currency)}</span><small>Habituel {m.baselineCents === null ? "—" : money(m.baselineCents, currency)}</small>
                <small>{m.future ? "À venir" : !m.available ? "Sans données" : !m.comparable ? "Couverture partielle" : m.partial ? "Mois partiel" : !m.baselineReady ? "Historique court" : "Comparable"}</small>
            </button>)}</div>
        </section>
        <section className="surface view-stack" aria-labelledby="trends-month-title">
            <div className="trend-navigation"><button className="button secondary" aria-label="Mois analysé précédent" onClick={() => onMonth(shiftMonth(trend.month, -1))}>Précédent</button><label>Mois analysé<input type="month" aria-label="Mois analysé" value={trend.month} onChange={e => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value)) onMonth(e.target.value); }} /></label><button className="button secondary" aria-label="Mois analysé suivant" onClick={() => onMonth(shiftMonth(trend.month, 1))}>Suivant</button></div>
            <h2 id="trends-month-title">{monthName(trend.month)}</h2>
            <p>{trend.available ? `${trend.from} au ${trend.to}` : "Aucune période disponible"}{trend.partial ? ` · ${trend.elapsedDays} premiers jours` : ""}</p>
            <div className="trend-headline"><Gauge actual={trend.actualCents} baseline={trend.baselineCents} /><div><small>Dépenses observées, remboursements déduits</small><p className="trend-total">{money(trend.actualCents, currency)}</p><p>Habituel observé : <strong>{money(trend.baselineCents, currency)}</strong></p>{difference !== null && <p>{difference === 0 ? "Au niveau de l'habituel observé" : `${money(Math.abs(difference), currency)} ${difference > 0 ? "au-dessus" : "en dessous"} de l'habituel observé`}</p>}</div></div>
            {!trend.comparable ? <div className="trend-coverage" role="status"><strong>Comparaison indisponible</strong><ul>{trend.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul><p>Un montant présent reste un montant observé; un compte incomplet n'est pas considéré comme nul.</p></div> : !trend.baselineReady ? <p className="trend-coverage" role="status">Historique insuffisant : {trend.qualifiedMonths.length} mois admissible(s), au moins {minimumBaselineMonths} requis parmi les {baselineWindowMonths} mois précédents.</p> : <p>Référence : {trend.qualifiedMonths.join(", ")}. {trend.partial ? `Moyenne des ${trend.elapsedDays} premiers jours de chacun de ces mois.` : "Moyenne de ces mois entiers."}</p>}
            <p className="muted">Les dates disponibles ne garantissent pas un import exhaustif. {trend.summary.included.filter(r => !r.reviewed).length} opération(s) de dépenses du mois ont encore une classification suggérée.</p>
            <details className="trend-method"><summary>Méthode et couverture des sources</summary><div className="view-stack">
                <p>La fenêtre comprend les six mois précédents, sans le mois cible ni les mois futurs. Au moins trois mois doivent être entièrement dans les dates importées de chacun des comptes de dépenses choisis. Aucune extrapolation. Un compte de placement sans dépenses n'est pas ajouté à ce périmètre.</p>
                <p>Pour un mois partiel, seules les mêmes premières journées sont comparées; un mois trop court est exclu. Pour un mois terminé, les mois entiers sont comparés et les courbes gardent leurs jours calendaires, même si leurs longueurs diffèrent.</p>
                <p>Les paiements de carte, transferts, placements, doublons confirmés et opérations de nature « À vérifier » ne sont pas additionnés aux dépenses. Les dépenses à catégoriser restent incluses. Aucun partage du versement hypothécaire n'est inventé.</p>
                <ul>{trend.candidates.map(c => <li key={c.month}>{c.month} : {c.reasons.length ? c.reasons.join("; ") : `admissible, comparaison du ${c.from} au ${c.comparisonTo}`}</li>)}</ul>
                <ul>{trend.coverage.map(c => <li key={c.account}><strong>{c.account}</strong>{c.rows.length ? c.rows.map((r, i) => <p key={i}>{r.earliest ?? "Début inconnu"} au {r.latest ?? "Fin inconnue"}{r.warning ? ` · ${r.warning}` : ""}</p>) : <p>Bornes absentes</p>}</li>)}</ul>
                {!!state.data?.limits.length && <details><summary>Notes de préparation des sources</summary><p>Notes conservées à l'import; des décisions manuelles peuvent avoir été enregistrées depuis.</p><ul>{state.data.limits.map((limit, i) => <li key={i}>{limit}</li>)}</ul></details>}
            </div></details>
        </section>
        <section className="surface view-stack"><h2>Cumul au fil du mois</h2><DailyCurve trend={trend} currency={currency} /></section>
        <section className="surface view-stack"><div className="trend-heading"><h2>Comparaison par catégorie</h2><label>Afficher une catégorie<select aria-label="Afficher une catégorie" value={category} onChange={e => setCategory(e.target.value)}><option value="">Toutes les catégories</option>{Object.entries(expenseCategories).filter(([key]) => key !== "savings-investments").map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
            <p>Ouvrez une catégorie pour consulter et modifier les opérations du mois sélectionné.</p>
            <div className="trend-categories">{categories.map(c => <button key={c.key} className="trend-category" onClick={() => onCategory(c.key)}>
                <strong>{c.label}</strong><span className="trend-category-amounts"><span>Observé <b>{money(c.actualCents, currency)}</b></span><span>Habituel <b>{money(c.baselineCents, currency)}</b></span></span>
                <svg viewBox="0 0 310 26" preserveAspectRatio="none" aria-hidden="true"><line x1={position(0)} x2={position(0)} y1="0" y2="26" stroke="var(--muted)" />{c.actualCents !== null && <rect x={Math.min(position(0), position(c.actualCents))} y="2" width={Math.abs(position(c.actualCents) - position(0))} height="8" fill="var(--green)" />}{c.baselineCents !== null && <rect x={Math.min(position(0), position(c.baselineCents))} y="15" width={Math.abs(position(c.baselineCents) - position(0))} height="8" fill="none" stroke="var(--muted)" strokeDasharray="4 2" />}</svg>
                <small>Voir les {c.count} opération(s) de dépenses du mois</small>
            </button>)}</div>{!categories.length && <p>Aucune dépense disponible pour cette catégorie et cette période.</p>}
        </section>
        {(trend.pendingCount > 0 || trend.pendingRows.length > 0) && <section className="surface view-stack"><h2>Opérations en attente</h2>{trend.pendingCount > 0 && <p>{trend.pendingCount} élément(s) signalé(s) dans l'import complet. Ce nombre n'est pas ventilé par mois ou compte.</p>}<p>Les opérations en attente ne sont ajoutées ni aux dépenses ni à l'habituel. Le décompte global et les détails ci-dessous ne s'additionnent pas.</p>{trend.pendingRows.length ? <ul>{trend.pendingRows.map(r => <li key={r.id}>{r.date} · {r.description} · {money(r.outflowCents, r.currency)} · En attente</li>)}</ul> : <p>Les dates et montants détaillés ne sont pas disponibles pour cette sélection.</p>}</section>}
    </div>;
}
