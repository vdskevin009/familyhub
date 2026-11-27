import { useMemo, useRef, useState } from "react";
import { expenseCategories, type ExpenseCategory, type FinanceState } from "../../../worker/src/finance-model";
import { baselineWindowMonths, shiftMonth, type SpendingTrend } from "../finance-trends";
import { Sheet } from "../ui/primitives";
import { useFinanceDialogHistory } from "../use-finance-dialog-history";
import { attributeSpendingDifference, leadingSpendingDifferences } from "../finance-trend-attribution";
import { displayFinanceCapture, FinanceCollectionNote } from "./FinanceCollectionNote";
import InfoPopover from "../ui/InfoPopover";
import "../finance-trends.css";

const money = (cents: number | null, currency: string) => cents === null ? "Unavailable" : new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(cents / 100);
const monthName = (month: string, short = false) => new Date(month + "-15T12:00:00Z").toLocaleDateString("en-CA", { month: short ? "short" : "long", ...(short ? {} : { year: "numeric" }) });

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
    if (!values.length) return <p>No daily totals for this month.</p>;
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
                <svg viewBox="0 0 360 180" preserveAspectRatio="none" role="img" aria-label="Observed daily totals and baseline. All values are available in the table below.">
                    {[low, (high + low) / 2, high].map(v => <line key={v} x1="8" x2="352" y1={y(v)} y2={y(v)} stroke="var(--line)" />)}
                    {baseline.length > 0 && <path d={path(baseline)} fill="none" stroke="var(--muted)" strokeWidth="2" strokeDasharray="6 4" />}
                    {actual.length > 0 && <><path d={path(actual)} fill="none" stroke="var(--green)" strokeWidth="3" /><circle cx={actual.at(-1)!.x} cy={actual.at(-1)!.y} r="4" fill="var(--green)" /></>}
                </svg>
            </div>
            <div className="trend-x-labels"><span>Jour 1</span><span>Jour {Math.ceil(trend.daily.length / 2)}</span><span>Jour {trend.daily.length}</span></div>
            <figcaption className="trend-legend"><span className="trend-key actual">Observed</span><span className="trend-key typical">Baseline {trend.baselineReady ? "available" : "unavailable"}</span></figcaption>
        </figure>
        <details><summary>Daily values</summary><table className="trend-table"><caption>Cumulative spending, net of refunds</caption><thead><tr><th>Day</th><th>Observed</th><th>Baseline</th></tr></thead><tbody>{trend.daily.map(d => <tr key={d.day}><th>{d.day}</th><td>{d.actualCents === null && d.day > trend.elapsedDays ? "Month ended" : money(d.actualCents, currency)}</td><td>{money(d.baselineCents, currency)}</td></tr>)}</tbody></table></details>
    </>;
}

export default function FinanceTrends({ state, trend, account, currency, onMonth, onCategory, unresolvedCount = 0 }: {
    state: FinanceState; trend: SpendingTrend; account: string; currency: string;
    onMonth: (month: string) => void; onCategory: (category: ExpenseCategory) => void; unresolvedCount?: number;
}) {
    const [detail,setDetail] = useState(false), trigger = useRef<HTMLButtonElement>(null);
    const attribution = useMemo(()=>attributeSpendingDifference(trend),[trend]);
    const leaders = leadingSpendingDifferences(attribution);
    const leaderScale = Math.max(1, ...leaders.map(row => Math.abs(row.displayDifferenceCents)));
    const signed = (cents:number)=>`${cents>0?"+":""}${money(cents,currency)}`;
    const collection = state.imports.at(-1)?.collection;
    const close = ()=>{setDetail(false);requestAnimationFrame(()=>trigger.current?.focus());};
    useFinanceDialogHistory(detail,close);
    const openMonth = (month:string)=>{if(/^\d{4}-(0[1-9]|1[0-2])$/.test(month))onMonth(month);};
    const method = <div className="view-stack trend-method">
        <p>{trend.from} to {trend.to}{trend.partial ? ` · ${trend.elapsedDays} first days` : ""}. {trend.referenceIndicative ? "Indicative baseline." : ""}</p>
        <p>The baseline averages observed periods from the prior {baselineWindowMonths} months, excluding the selected month and incomplete months. A partial month is compared over the same first {trend.elapsedDays} days. Missing months are excluded, not treated as zero. No values are extrapolated.</p>
        <p>Transaction dates do not establish complete history. Incomplete accounts are not assumed to be zero. A favourable difference is not guaranteed savings.</p>
        <p>Transfers, card payments, investments, confirmed duplicates and transaction types that need review are excluded. Refunds keep their original sign. {trend.summary.included.filter(r=>!r.reviewed).length} classifications are still suggestions.</p>
        {unresolvedCount>0 && <p>{unresolvedCount} source transactions without verified matches are excluded from this subtotal. Find them in Spending.</p>}
        <FinanceCollectionNote state={state}/>
        <details><summary>Method and source coverage</summary>
            <ul>{trend.candidates.map(c=><li key={c.month}>{c.month} : {c.reasons.length ? c.reasons.join("; ") : `eligible, compared from ${c.from} to ${c.comparisonTo}`}</li>)}</ul>
            <ul>{trend.coverage.map(c=><li key={c.account}><strong>{c.account}</strong>{c.rows.length ? c.rows.map((r,i)=><p key={i}>{r.earliest ?? "Unknown start"} to {r.latest ?? "Unknown end"}{r.warning ? ` · ${r.warning}` : ""}</p>) : <p>Date range missing</p>}</li>)}</ul>
            {!!state.data?.limits.length && <details><summary>Source preparation notes</summary><ul>{state.data.limits.map((limit,i)=><li key={i}>{limit}</li>)}</ul></details>}
            {trend.pendingCount>0 && <p>{trend.pendingCount} pending item(s) in the full import, excluded from spending. {trend.pendingRows.length ? `${trend.pendingRows.length} in this selection.` : "Dates and accounts are not available for this selection."}</p>}
        </details>
    </div>;
    return <div className="finance-trends view-stack">
        <div className="trend-month-navigation" aria-label="Navigation mensuelle">
            <button type="button" className="icon-button" aria-label="Previous month" onClick={()=>openMonth(shiftMonth(trend.month,-1))}>‹</button>
            {[-2,-1,0,1].map(offset=>{const month=shiftMonth(trend.month,offset);return <button type="button" key={month} data-trend-month={month} className={month===trend.month?"selected":""} aria-current={month===trend.month?"date":undefined} aria-label={monthName(month)} onClick={()=>openMonth(month)}>{monthName(month,true)}</button>;})}
            <button type="button" className="icon-button" aria-label="Next month" onClick={()=>openMonth(shiftMonth(trend.month,1))}>›</button>
        </div>
        <div className="compact-heading trend-period-heading"><h2 id="trends-month-title" tabIndex={-1}>{monthName(trend.month)}</h2><label><span className="sr-only">Month analysed</span><input type="month" aria-label="Month analysed" value={trend.month} onChange={e=>openMonth(e.target.value)}/></label></div>
        <section className="surface view-stack trend-overview" aria-label="Monthly summary">
            <div className="trend-headline"><span>Net spending · {currency}</span><strong className="trend-total" data-trend-actual={trend.actualCents ?? "unknown"}>{money(trend.actualCents,currency)}</strong>
                {attribution.available ? <button type="button" ref={trigger} className={`trend-difference ${attribution.displayDifferenceCents!<0?"favorable":attribution.displayDifferenceCents!>0?"higher":"equal"}`} data-trend-delta={attribution.displayDifferenceCents} aria-haspopup="dialog" aria-expanded={detail} onClick={()=>setDetail(true)}>{signed(attribution.displayDifferenceCents!)} vs. baseline <span aria-hidden="true">›</span></button> : <p className="trend-no-reference">{attribution.unavailableReason==="observed-unavailable" ? "Difference not established: observed amount unavailable." : attribution.unavailableReason==="inconsistent-categories" ? "A breakdown of the difference is not available." : "Baseline unavailable"}</p>}
                <p className="trend-reference-status" role="status">{trend.baselineReady ? `${trend.referenceIndicative ? "Indicative baseline" : "Observed baseline"} : ${money(trend.baselineCents,currency)} · same period` : "No baseline amount is assumed."}{trend.partial ? ` · ${trend.elapsedDays} first days` : ""}</p>
            </div>
            <DailyCurve trend={trend} currency={currency}/>
        </section>
        <section className="surface view-stack trend-explanation" aria-label="Explanation of the difference"><h2>What explains the difference</h2>
            {attribution.available ? <><p className="finance-signed-legend" aria-hidden="true"><span>Moins</span><span>0</span><span>Plus</span></p><ul>{leaders.map(c=>{
                const width = Math.abs(c.displayDifferenceCents) / leaderScale * 50;
                return <li key={c.key}><button type="button" className="trend-category" data-trend-leading={c.key} onClick={()=>c.categoryKeys.length===1 ? onCategory(c.categoryKeys[0] as ExpenseCategory) : setDetail(true)}>
                    <span className="trend-leading-label"><span>{c.label}</span><strong className={c.displayDifferenceCents<0?"favorable":c.displayDifferenceCents>0?"higher":""}>{signed(c.displayDifferenceCents)}</strong></span>
                    <span className="trend-attribution-track" aria-hidden="true"><span className={c.displayDifferenceCents<0?"favorable":c.displayDifferenceCents>0?"higher":""} style={{ left: `${c.displayDifferenceCents < 0 ? 50 - width : 50}%`, width: `${width}%` }} /></span>
                </button></li>;
            })}</ul></> : <p>No comparable baseline is available. No difference is assumed.</p>}
        </section>
        <div className="trend-collection compact-heading"><small>{collection ? <>Collected on <time dateTime={collection.retrievedAt}>{displayFinanceCapture(collection.retrievedAt)}</time></> : "Collection date unavailable"}{unresolvedCount>0 ? ` · ${unresolvedCount} transactions to reconcile` : ""}</small><InfoPopover title="How to read trends">{method}</InfoPopover></div>
        <Sheet open={detail} onClose={close} title="Difference from baseline" wide className="trend-attribution-dialog">
            <div className="view-stack"><p>{monthName(trend.month)} · {account ? state.data?.accounts.find(a=>a.id===account)?.name ?? "Selected account" : "All accounts"} · {currency}</p>
                <strong className={`trend-attribution-total ${attribution.displayDifferenceCents!==null&&attribution.displayDifferenceCents<0?"favorable":"higher"}`}>{attribution.displayDifferenceCents===null ? "Not established" : signed(attribution.displayDifferenceCents)}</strong>
                <p>{money(trend.actualCents,currency)} observed / {money(trend.baselineCents,currency)} baseline. {trend.referenceIndicative ? "Indicative baseline." : ""}</p>
                <h3>What changed</h3><p className="trend-axis-legend">Less ← 0 → More</p>
                <ul className="trend-attribution-list">{attribution.categories.map(c=>{const width=Math.abs(c.displayDifferenceCents)/attribution.scaleCents!*50;return <li key={c.key}><button type="button" data-trend-category={c.key} data-difference-cents={c.displayDifferenceCents} aria-label={`${c.label}: difference ${signed(c.displayDifferenceCents)}. Observed ${money(c.actualCents,currency)}, baseline ${money(c.displayBaselineCents,currency)}. View transactions.`} onClick={()=>onCategory(c.key as ExpenseCategory)}><span><strong>{expenseCategories[c.key as ExpenseCategory] ?? c.label}</strong><small>{money(c.actualCents,currency)} observed</small></span><span><span className="trend-attribution-track" aria-hidden="true"><span className={c.displayDifferenceCents<0?"favorable":"higher"} style={{left:`${c.displayDifferenceCents<0?50-width:50}%`,width:`${width}%`}}/></span><strong className={c.displayDifferenceCents<0?"favorable":"higher"}>{signed(c.displayDifferenceCents)}</strong></span></button></li>;})}</ul>
                <p>All categories are included. Their displayed differences account for the total. A favourable difference is not guaranteed savings.</p>
                <button type="button" className="button secondary" onClick={close}>Close difference details</button>
            </div>
        </Sheet>
    </div>;
}
