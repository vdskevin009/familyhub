import { useMemo, useRef, useState } from "react";
import type { SourceExpensesSnapshot } from "../../../worker/src/finance-source-expenses-model";
import { sourceSpendingTrend } from "../finance-source-trends";
import { shiftMonth } from "../finance-trends";
import { displayFinanceCapture } from "./FinanceCollectionNote";
import { DailyCurve, Gauge } from "./FinanceTrends";
import { sourceExpenseCategoryNames, sourceExpenseClassNames } from "./FinanceSourceExpenses";
import "../finance-source-expenses.css";

const money = (value: number | null, currency: string) => value === null ? "Non établi" : new Intl.NumberFormat("fr-CA", { style: "currency", currency }).format(value / 100);
const label = (month: string, short = false) => new Date(month + "-15T12:00:00Z").toLocaleDateString("fr-CA", { month: short ? "short" : "long", ...(short ? {} : { year: "numeric" }), timeZone: "UTC" });

export default function FinanceSourceTrends({ snapshots }: { snapshots: SourceExpensesSnapshot[] }) {
  const [capture, setCapture] = useState("");
  const snapshot = snapshots.find(s => s.collectedAt === capture) ?? snapshots.at(-1);
  return <section className="surface source-expenses source-trends view-stack">
    <h2>Tendances de la source</h2>
    <p>Une collecte à la fois, séparée du registre historique. Aucun cumul entre les deux jeux de données.</p>
    {!snapshot ? <p>Aucune collecte enregistrée. Cela ne signifie pas qu'il n'y a aucune dépense.</p> : <>
      <details><summary>Changer de collecte ({snapshots.length})</summary><label>Collecte des tendances<select aria-label="Collecte des tendances" value={snapshot.collectedAt} onChange={e => setCapture(e.target.value)}>{[...snapshots].reverse().map(s => <option key={s.collectedAt} value={s.collectedAt}>{displayFinanceCapture(s.collectedAt)}</option>)}</select></label></details>
      <SourceTrendSnapshot key={snapshot.collectedAt + snapshot.evidenceSha256} snapshot={snapshot} />
    </>}
  </section>;
}

function SourceTrendSnapshot({ snapshot }: { snapshot: SourceExpensesSnapshot }) {
  const root = useRef<HTMLDivElement>(null);
  const [month, setMonth] = useState(snapshot.query.through.slice(0, 7)), [account, setAccount] = useState("");
  const currencies = useMemo(() => [...new Set(snapshot.rows.map(r => r.currency))].sort(), [snapshot]);
  const [currency, setCurrency] = useState(currencies.includes("CAD") ? "CAD" : currencies[0] ?? "");
  const [detail, setDetail] = useState(false), [category, setCategory] = useState(""), [limit, setLimit] = useState(20);
  const year = month.slice(0, 4);
  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => sourceSpendingTrend(snapshot, `${year}-${String(i + 1).padStart(2, "0")}`, account, currency)), [snapshot, year, account, currency]);
  const trend = months[Number(month.slice(5)) - 1];
  const scale = Math.max(1, ...months.flatMap(m => [Math.abs(m.actualCents ?? 0), Math.abs(m.baselineCents ?? 0)]));
  const firstYear = Number(snapshot.query.from.slice(0, 4)), lastYear = Number(snapshot.query.through.slice(0, 4));
  const years = Array.from({ length: lastYear - firstYear + 1 }, (_, i) => lastYear - i);
  const focus = (selector: string) => requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(selector)?.focus());
  const open = (value: string) => { setMonth(value); setDetail(true); setCategory(""); setLimit(20); focus("#source-trend-month-title"); };
  const grouped = [...new Set(trend.included.map(r => r.row.category.primary ?? "unknown"))];
  const rows = trend.summary.rows.filter(r => !category || !r.row.pending && ["expense", "refund"].includes(r.kind) && r.row.category.primary === category).sort((a, b) => b.row.date.localeCompare(a.row.date) || a.row.sourceKey.localeCompare(b.row.sourceKey));
  return <div ref={root} className="finance-trends view-stack">
    <p className="source-expense-capture">Reçu le <time dateTime={snapshot.collectedAt}>{displayFinanceCapture(snapshot.collectedAt)}</time>{Date.now() - Date.parse(snapshot.collectedAt) > 86400_000 && <strong> · Collecte ancienne (plus de 24 h)</strong>}<br />{snapshot.coverage.sourceAsOf ? <>Date de source fournie : {snapshot.coverage.sourceAsOf.length === 10 ? snapshot.coverage.sourceAsOf : displayFinanceCapture(snapshot.coverage.sourceAsOf)}.</> : "Date de mise à jour bancaire inconnue."}</p>
    <div className="source-expense-filters"><label>Année des tendances<select aria-label="Année des tendances" value={year} onChange={e => { setMonth(e.target.value + month.slice(4)); setDetail(false); }}>{years.map(y => <option key={y}>{y}</option>)}</select></label><label>Compte source<select aria-label="Compte source" value={account} onChange={e => { setAccount(e.target.value); setCategory(""); setLimit(20); }}><option value="">Tous les comptes de cette collecte</option>{snapshot.accounts.map(a => <option key={a.sourceKey} value={a.sourceKey}>{a.name}</option>)}</select></label><label>Devise<select aria-label="Devise" value={currency} onChange={e => { setCurrency(e.target.value); setCategory(""); setLimit(20); }}>{currencies.length ? currencies.map(c => <option key={c}>{c}</option>) : <option value="">Non fournie</option>}</select></label></div>
    <p className="trend-coverage">{snapshot.coverage.complete ? "Couverture attestée pour la requête seulement" : "Couverture limitée ou non établie"} : {snapshot.query.from} au {snapshot.query.through}, {account ? snapshot.accounts.find(a => a.sourceKey === account)?.name : `${snapshot.accounts.length} comptes source`}. Catégories provisoires, non confirmées.</p>
    {!detail ? <>
      <div className="trend-months">{months.map(m => <button type="button" key={m.month} data-source-trend-month={m.month} aria-label={`Ouvrir ${label(m.month)}. ${money(m.actualCents, currency)}. ${m.partial ? "Mois incomplet" : !m.available ? "Hors collecte" : "Montant observé"}`} onClick={() => open(m.month)}><strong>{label(m.month, true)}</strong><Gauge actual={m.actualCents} baseline={m.baselineCents} scale={scale} /><span>{money(m.actualCents, currency)}</span><small>{!m.available ? "Hors collecte" : m.partial ? "Mois incomplet" : "Observé dans la collecte"}</small><small className="trend-tile-reference">{m.baselineReady ? `Réf. : ${money(m.baselineCents, currency)}` : "Réf. indisponible"}</small></button>)}</div>
      <p className="trend-legend"><span className="trend-key actual">Sous-total observé</span><span className="trend-key typical">Référence de cette collecte</span><span>Échelle annuelle commune, crédits nets à gauche de 0.</span></p>
    </> : <>
      <button type="button" className="button secondary" onClick={() => { setDetail(false); focus(`[data-source-trend-month="${month}"]`); }}>Retour à l'année</button>
      <div className="trend-navigation"><button className="icon-button" aria-label="Mois source précédent" disabled={month <= snapshot.query.from.slice(0, 7)} onClick={() => open(shiftMonth(month, -1))}>‹</button><h3 id="source-trend-month-title" tabIndex={-1}>{label(month)}</h3><button className="icon-button" aria-label="Mois source suivant" disabled={month >= snapshot.query.through.slice(0, 7)} onClick={() => open(shiftMonth(month, 1))}>›</button></div>
      <div className="trend-headline"><Gauge actual={trend.actualCents} baseline={trend.baselineCents} scale={scale} /><div><p>Sous-total net selon les catégories source</p><strong className="trend-total" data-source-trend-total>{money(trend.actualCents, currency)}</strong><p>Référence : {money(trend.baselineCents, currency)} ({trend.referenceMonths.length} mois).</p></div></div>
      <p>{trend.available ? `${trend.observedFrom} au ${trend.to}${trend.partial ? " · Mois incomplet, sans extrapolation" : ""}` : "Aucune période collectée pour ce mois."} {trend.summary.ambiguousCount} mouvement(s) à clarifier, {trend.summary.pendingCount} en attente et {trend.summary.excludedCount} exclu(s), tous hors total.</p>
      <p>Dépenses brutes : {money(trend.actualCents === null ? null : trend.summary.grossCents, currency)}. Crédits attribués : {money(trend.actualCents === null ? null : trend.summary.refundCents, currency)}.</p>
      <details className="trend-daily"><summary>Cumul quotidien</summary><DailyCurve trend={trend} currency={currency} /></details>
      <details open><summary>Catégories et opérations source</summary><label>Catégorie source<select aria-label="Catégorie source" value={category} onChange={e => { setCategory(e.target.value); setLimit(20); }}><option value="">Toutes les lignes, y compris celles hors total</option>{grouped.map(c => <option key={c} value={c}>{sourceExpenseCategoryNames[c] ?? "Catégorie non reconnue"}</option>)}</select></label>
        <dl className="source-expense-categories">{grouped.filter(c => !category || c === category).map(c => <div key={c}><dt>{sourceExpenseCategoryNames[c] ?? "Catégorie non reconnue"}</dt><dd>{money(trend.included.filter(r => r.row.category.primary === c).reduce((sum, r) => sum + r.row.outflowCents, 0), currency)}</dd></div>)}</dl>
        <ul className="source-expense-rows">{rows.slice(0, limit).map(({ row, kind }) => <li key={row.sourceKey}><div><strong>{row.description}</strong><span>{row.date} · {snapshot.accounts.find(a => a.sourceKey === row.accountSourceKey)?.name}</span><span>{row.pending ? "En attente, hors total" : sourceExpenseClassNames[kind]}</span></div><strong>{money(-row.outflowCents, row.currency)}</strong></li>)}</ul>
        {!rows.length && <p>Aucune ligne reçue pour ce filtre. Aucun zéro n'est déduit d'une absence de données.</p>}{rows.length > limit && <button className="button secondary" onClick={() => setLimit(n => n + 20)}>Voir les opérations suivantes ({rows.length - limit})</button>}
        <p>Les classifications de cette collecte sont conservées telles que reçues. Les corrections du registre historique restent dans le mode Registre historique.</p>
      </details>
    </>}
    <details><summary>Méthode et couverture</summary><p>Chaque montant vient uniquement de cette collecte, du compte et de la devise sélectionnés. Ni solde, ni revenu ou rendement de placement. Aucun rapprochement de comptes par nom ou numéro partiel.</p><p>La référence utilise les mois entièrement couverts parmi les six mois précédents, pour les mêmes comptes et la même devise. Un mois incomplet est comparé aux mêmes premiers jours. Une période avec couverture non attestée, début manquant ou mouvements ambigus n'a pas de référence. Les catégories restent provisoires; la moyenne n'est pas un objectif. Les mois sans dépense classée restent inconnus, jamais remplacés par zéro.</p>{detail && <p>Mois de référence : {trend.referenceMonths.join(", ") || "aucun"}.</p>}<p>{snapshot.coverage.hasMore === false ? "Pagination terminée." : "Pagination non terminée ou non attestée."} La réception ne prouve pas une nouvelle connexion bancaire.</p>{snapshot.coverage.warningCodes.length > 0 && <p>Avertissements : {snapshot.coverage.warningCodes.join(", ")}</p>}</details>
  </div>;
}
