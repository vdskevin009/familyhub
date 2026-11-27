import { useMemo, useRef, useState } from "react";
import type { SourceExpensesSnapshot } from "../../../worker/src/finance-source-expenses-model";
import { sourceSpendingTrend } from "../finance-source-trends";
import { shiftMonth } from "../finance-trends";
import { displayFinanceCapture } from "./FinanceCollectionNote";
import { DailyCurve, Gauge } from "./FinanceTrends";
import { sourceExpenseCategoryNames, sourceExpenseClassNames } from "./FinanceSourceExpenses";
import "../finance-source-expenses.css";

const money = (value: number | null, currency: string) => value === null ? "Not established" : new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(value / 100);
const label = (month: string, short = false) => new Date(month + "-15T12:00:00Z").toLocaleDateString("en-CA", { month: short ? "short" : "long", ...(short ? {} : { year: "numeric" }), timeZone: "UTC" });

export default function FinanceSourceTrends({ snapshots }: { snapshots: SourceExpensesSnapshot[] }) {
  const [capture, setCapture] = useState("");
  const snapshot = snapshots.find(s => s.collectedAt === capture) ?? snapshots.at(-1);
  return <section className="surface source-expenses source-trends view-stack">
    <h2>Source trends</h2>
    <p>One collection at a time, separate from the historical register. The two data sets are not combined.</p>
    {!snapshot ? <p>No collection was saved. This does not establish that there was no spending.</p> : <>
      <details><summary>Change collection ({snapshots.length})</summary><label>Collection for trends<select aria-label="Collection for trends" value={snapshot.collectedAt} onChange={e => setCapture(e.target.value)}>{[...snapshots].reverse().map(s => <option key={s.collectedAt} value={s.collectedAt}>{displayFinanceCapture(s.collectedAt)}</option>)}</select></label></details>
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
    <p className="source-expense-capture">Received on <time dateTime={snapshot.collectedAt}>{displayFinanceCapture(snapshot.collectedAt)}</time>{Date.now() - Date.parse(snapshot.collectedAt) > 86400_000 && <strong> · Collection older than 24 hours</strong>}<br />{snapshot.coverage.sourceAsOf ? <>Source date: {snapshot.coverage.sourceAsOf.length === 10 ? snapshot.coverage.sourceAsOf : displayFinanceCapture(snapshot.coverage.sourceAsOf)}.</> : "Bank update date unknown."}</p>
    <div className="source-expense-filters"><label>Trend year<select aria-label="Trend year" value={year} onChange={e => { setMonth(e.target.value + month.slice(4)); setDetail(false); }}>{years.map(y => <option key={y}>{y}</option>)}</select></label><label>Source account<select aria-label="Source account" value={account} onChange={e => { setAccount(e.target.value); setCategory(""); setLimit(20); }}><option value="">All accounts in this collection</option>{snapshot.accounts.map(a => <option key={a.sourceKey} value={a.sourceKey}>{a.name}</option>)}</select></label><label>Currency<select aria-label="Currency" value={currency} onChange={e => { setCurrency(e.target.value); setCategory(""); setLimit(20); }}>{currencies.length ? currencies.map(c => <option key={c}>{c}</option>) : <option value="">Not provided</option>}</select></label></div>
    <p className="trend-coverage">{snapshot.coverage.complete ? "Coverage verified for this query only" : "Limited or unverified coverage"} : {snapshot.query.from} to {snapshot.query.through}, {account ? snapshot.accounts.find(a => a.sourceKey === account)?.name : `${snapshot.accounts.length} source accounts`}. Categories are provisional and unconfirmed.</p>
    {!detail ? <>
      <div className="trend-months">{months.map(m => <button type="button" key={m.month} data-source-trend-month={m.month} aria-label={`Open ${label(m.month)}. ${money(m.actualCents, currency)}. ${m.partial ? "Partial month" : !m.available ? "Outside collection" : "Observed amount"}`} onClick={() => open(m.month)}><strong>{label(m.month, true)}</strong><Gauge actual={m.actualCents} baseline={m.baselineCents} scale={scale} /><span>{money(m.actualCents, currency)}</span><small>{!m.available ? "Outside collection" : m.partial ? "Partial month" : "Observed in the collection"}</small><small className="trend-tile-reference">{m.baselineReady ? `Baseline: ${money(m.baselineCents, currency)}` : "Baseline unavailable"}</small></button>)}</div>
      <p className="trend-legend"><span className="trend-key actual">Observed subtotal</span><span className="trend-key typical">Collection baseline</span><span>Shared annual scale. Net credits are to the left of zero.</span></p>
    </> : <>
      <button type="button" className="button secondary" onClick={() => { setDetail(false); focus(`[data-source-trend-month="${month}"]`); }}>Back to year</button>
      <div className="trend-navigation"><button className="icon-button" aria-label="Previous source month" disabled={month <= snapshot.query.from.slice(0, 7)} onClick={() => open(shiftMonth(month, -1))}>‹</button><h3 id="source-trend-month-title" tabIndex={-1}>{label(month)}</h3><button className="icon-button" aria-label="Next source month" disabled={month >= snapshot.query.through.slice(0, 7)} onClick={() => open(shiftMonth(month, 1))}>›</button></div>
      <div className="trend-headline"><Gauge actual={trend.actualCents} baseline={trend.baselineCents} scale={scale} /><div><p>Net subtotal using source categories</p><strong className="trend-total" data-source-trend-total>{money(trend.actualCents, currency)}</strong><p>Baseline: {money(trend.baselineCents, currency)} ({trend.referenceMonths.length} month(s)).</p></div></div>
      <p>{trend.available ? `${trend.observedFrom} au ${trend.to}${trend.partial ? " · Partial month, not extrapolated" : ""}` : "No period was collected for this month."} {trend.summary.ambiguousCount} transaction(s) to clarify, {trend.summary.pendingCount} pending and {trend.summary.excludedCount} excluded, all outside the total.</p>
      <p>Gross spending: {money(trend.actualCents === null ? null : trend.summary.grossCents, currency)}. Assigned credits: {money(trend.actualCents === null ? null : trend.summary.refundCents, currency)}.</p>
      <details className="trend-daily"><summary>Daily totals</summary><DailyCurve trend={trend} currency={currency} /></details>
      <details open><summary>Source categories and transactions</summary><label>Source category<select aria-label="Source category" value={category} onChange={e => { setCategory(e.target.value); setLimit(20); }}><option value="">All rows, including those excluded from totals</option>{grouped.map(c => <option key={c} value={c}>{sourceExpenseCategoryNames[c] ?? "Unrecognized category"}</option>)}</select></label>
        <dl className="source-expense-categories">{grouped.filter(c => !category || c === category).map(c => <div key={c}><dt>{sourceExpenseCategoryNames[c] ?? "Unrecognized category"}</dt><dd>{money(trend.included.filter(r => r.row.category.primary === c).reduce((sum, r) => sum + r.row.outflowCents, 0), currency)}</dd></div>)}</dl>
        <ul className="source-expense-rows">{rows.slice(0, limit).map(({ row, kind }) => <li key={row.sourceKey}><div><strong>{row.description}</strong><span>{row.date} · {snapshot.accounts.find(a => a.sourceKey === row.accountSourceKey)?.name}</span><span>{row.pending ? "Pending, excluded from total" : sourceExpenseClassNames[kind]}</span></div><strong>{money(-row.outflowCents, row.currency)}</strong></li>)}</ul>
        {!rows.length && <p>No received rows match this filter. Missing data is not treated as zero.</p>}{rows.length > limit && <button className="button secondary" onClick={() => setLimit(n => n + 20)}>View more transactions ({rows.length - limit})</button>}
        <p>The collection retains the original source categories. Corrections remain in the historical register.</p>
      </details>
    </>}
    <details><summary>Method and coverage</summary><p>Each amount comes only from the selected collection, account and currency. It does not represent account balances, income or investment returns. Accounts are not matched by name or partial number.</p><p>The baseline uses fully covered months from the preceding six months, for the same accounts and currency. Partial months are compared over the same number of days from the start of the month. Periods with unverified coverage, a missing start or ambiguous transactions have no baseline. Categories remain provisional, and the average is not a goal. Months without categorized spending remain unknown, not zero.</p>{detail && <p>Baseline months: {trend.referenceMonths.join(", ") || "none"}.</p>}<p>{snapshot.coverage.hasMore === false ? "All pages received." : "Page coverage incomplete or unverified."} Receiving data does not establish that there was a new bank connection.</p>{snapshot.coverage.warningCodes.length > 0 && <p>Warnings: {snapshot.coverage.warningCodes.join(", ")}</p>}</details>
  </div>;
}
