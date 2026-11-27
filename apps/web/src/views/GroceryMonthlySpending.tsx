import { useState } from "react";
import type { GroceryRecord } from "../../../worker/src/grocery-model";
import { pcExpressMonthlySpending } from "../grocery-monthly-spending";
import "../grocery-monthly-spending.css";
const money = (value: number, currency: string) => new Intl.NumberFormat("en-CA", { style: "currency", currency, currencyDisplay: "code" }).format(value);
const label = (month: string, short = false) => new Intl.DateTimeFormat("en-CA", { month: short ? "short" : "long", ...(short ? {} : {year: "numeric" as const}), timeZone: "UTC" }).format(new Date(month + "-01T12:00:00Z"));
export default function GroceryMonthlySpending({ records, offline }: { records: GroceryRecord[]; offline: boolean }) {
  const summary = pcExpressMonthlySpending(records);
  const omitted = summary.excluded + summary.conflicts;
  const years = [...new Set(summary.months.map(m => m.month.slice(0, 4)))].sort().reverse();
  const [selection, setSelection] = useState("");
  const year = years.includes(selection) ? selection : years[0];
  const months = summary.months.filter(m => m.month.startsWith(year || "none"));
  const currencies = [...new Set(months.map(m => m.currency))];
  return <section className="grocery-spending" aria-label="Monthly PC Express spending">
    <div className="grocery-section-heading"><div><p className="grocery-spending-eyebrow">PC Express · available history</p><h2>Spending by month</h2></div>{years.length > 1 && <label>Year<select aria-label="Year" value={year} onChange={e => setSelection(e.target.value)}>{years.map(y => <option key={y}>{y}</option>)}</select></label>}</div>
    <p>Verified final receipts and estimated confirmations are shown separately. An estimate does not prove a payment. The chart uses PC Express sources with usable amounts, including non-food purchases.</p>
    {offline && <p className="grocery-warning">Cached data: the latest emails have not been checked.</p>}
    {omitted > 0 && <details className="grocery-warning">
      <summary>History: {omitted} {omitted === 1 ? "case" : "cases"} excluded from totals</summary>
      <p>This count covers all saved years and currencies, not just the current selection.</p>
      {summary.excluded > 0 && <p>{summary.excluded} {summary.excluded === 1 ? "case is" : "cases are"} missing a usable date, currency, amount or evidence type.</p>}
      {summary.conflicts > 0 && <p>{summary.conflicts} {summary.conflicts === 1 ? "case has" : "cases have"} conflicting amounts, dates, currencies or references.</p>}
      <p>Original sources are retained. Find the receipts under Recent purchases or Archive and other receipts, then open More details and Purchase evidence and limitations. Missing amounts and payments are not inferred.</p>
    </details>}
    {!months.length ? <p className="grocery-empty">{summary.sourceCount > 0 ? "Sources are available, but their amounts could not be established. Check the excluded cases above. This does not mean spending was zero." : "No usable PC Express sources are saved yet. Imported purchases will appear here when their amounts are known."}</p> : currencies.map(currency => {
      const rows = months.filter(m => m.currency === currency), max = Math.max(1, ...rows.flatMap(m => [m.paid, m.estimated]));
      const firstMonth = Math.min(...rows.map(m => Number(m.month.slice(5)))), lastMonth = Math.max(...rows.map(m => Number(m.month.slice(5))));
      const paid = rows.reduce((s, m) => s + Math.round(m.paid * 100), 0) / 100, estimated = rows.reduce((s, m) => s + Math.round(m.estimated * 100), 0) / 100;
      return <div key={currency} className="grocery-spending-currency">
        <div className="grocery-spending-summary"><div><span>Verified payments · {year}</span><strong>{rows.some(m => m.paidCount) ? money(paid, currency) : "Unknown"}</strong></div><div><span>Estimated orders · {year}</span><strong>{rows.some(m => m.estimatedCount) ? money(estimated, currency) : "None"}</strong></div></div>
        <p className="grocery-spending-legend"><span><i className="paid" />Verified payments</span><span><i className="estimated" />Estimated, payment unknown</span></p>
        <p className="grocery-spending-note">Scale: 0 to {money(max, currency)}</p>
        <div className="grocery-spending-scroll" role="region" aria-label={`Monthly chart ${year}, ${currency}`} tabIndex={0}>
          <div className="grocery-spending-bars" style={{ minWidth: `${(lastMonth - firstMonth + 1) * 44}px` }} role="img" aria-label={`Monthly amounts in ${currency}. Exact values are listed below the chart.`}>
            {Array.from({ length: lastMonth - firstMonth + 1 }, (_, index) => {
              const month = `${year}-${String(index + firstMonth).padStart(2, "0")}`, row = rows.find(m => m.month === month);
              return <div className="grocery-spending-column" key={month}>
                <div className="grocery-spending-pair" aria-hidden="true">{row ? <><span className="paid" style={{ height: `${row.paid / max * 100}%` }} title={`${label(month)}: ${money(row.paid, currency)} in verified payments`} /><span className="estimated" style={{ height: `${row.estimated / max * 100}%` }} title={`${label(month)}: ${money(row.estimated, currency)} estimated`} /></> : <span className="grocery-spending-missing">—</span>}</div>
                <span>{label(month, true)}</span>
              </div>;
            })}
          </div>
        </div>
        <p className="grocery-spending-note">— No usable amount found for this month. It does not mean zero spending. Both series use the same scale and the amounts are not added together.</p>
        <details><summary>Monthly amounts and orders · {currency}</summary><ul className="grocery-spending-values">{rows.map(row => <li key={row.month}><strong>{label(row.month)}</strong><span>{row.paidCount ? `${money(row.paid, currency)} paid · ${row.paidCount} receipt(s)` : "Paid: unknown"}</span><span>{row.estimatedCount ? `${money(row.estimated, currency)} estimated · ${row.estimatedCount} order(s)` : "No estimated confirmations"}</span></li>)}</ul></details>
      </div>;
    })}
    <details><summary>Coverage and method</summary><p>{summary.firstDate ? `Sources dated from ${summary.firstDate} to ${summary.lastDate}.` : "Coverage period unknown."} The chart uses all usable saved PC Express sources, including archived purchases, regardless of the source account. The receipt or confirmation date determines the month.</p><p>The complete email history has not been verified. Card authorisations are not included. This chart does not verify refunds or cancellations, or show net bank debits.</p><p>Each order reference counts once. A verified final receipt replaces the estimate in the chart without changing the sources.</p>{summary.duplicates > 0 && <p>{summary.duplicates} additional source(s) for the same order not counted.</p>}</details>
  </section>;
}
