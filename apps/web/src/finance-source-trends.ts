import { summarizeSourceExpenses, type SourceExpensesSnapshot } from "../../worker/src/finance-source-expenses-model";
import { monthEnd, shiftMonth } from "./finance-trends";

/** A single immutable source capture. Never unions captures or translates source account keys. */
export function sourceSpendingTrend(snapshot: SourceExpensesSnapshot, month: string, accountSourceKey = "", currency = "CAD") {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Mois invalide");
  const from = month + "-01", end = monthEnd(month);
  const to = end < snapshot.query.through ? end : snapshot.query.through;
  const observedFrom = from > snapshot.query.from ? from : snapshot.query.from;
  const available = observedFrom <= to;
  const partial = available && (observedFrom !== from || to !== end);
  const elapsedDays = available ? Number(to.slice(8)) : 0;
  const scopeValid = !accountSourceKey || snapshot.query.accountSourceKeys.includes(accountSourceKey);
  const summary = summarizeSourceExpenses(snapshot, { from, through: end, currency, accountSourceKey });
  const included = summary.rows.filter(r => !r.row.pending && ["expense", "refund"].includes(r.kind));
  const actualCents = available && scopeValid && summary.hasIncluded ? summary.netCents : null;
  const comparisonEligible = available && scopeValid && snapshot.coverage.complete && observedFrom === from && summary.ambiguousCount === 0 && actualCents !== null;
  const candidates = Array.from({ length: 6 }, (_, i) => {
    const previous = shiftMonth(month, i - 6), previousEnd = monthEnd(previous);
    const through = available && to < end ? `${previous}-${String(elapsedDays).padStart(2, "0")}` : previousEnd;
    const prior = summarizeSourceExpenses(snapshot, { from: previous + "-01", through, currency, accountSourceKey });
    const fullMonthCovered = previous + "-01" >= snapshot.query.from && previousEnd <= snapshot.query.through;
    const eligible = fullMonthCovered && (to >= end || Number(previousEnd.slice(8)) >= elapsedDays) && prior.hasIncluded && prior.ambiguousCount === 0;
    return { month: previous, through, summary: prior, eligible };
  });
  const reference = comparisonEligible ? candidates.filter(c => c.eligible) : [];
  const baselineCents = reference.length ? reference.reduce((sum, r) => sum + r.summary.netCents, 0) / reference.length : null;
  const chartDays = reference.length && to === end ? Math.max(elapsedDays, ...reference.map(r => Number(r.through.slice(8)))) : elapsedDays;
  const daily = Array.from({ length: chartDays }, (_, i) => {
    const day = i + 1;
    const actual = included.filter(r => Number(r.row.date.slice(8)) <= day);
    return { day, actualCents: actualCents === null || day > elapsedDays || day < Number(observedFrom.slice(8)) ? null : actual.reduce((sum, r) => sum + r.row.outflowCents, 0),
      baselineCents: reference.length ? reference.reduce((sum, r) => sum + r.summary.rows.filter(v => !v.row.pending && ["expense", "refund"].includes(v.kind) && Number(v.row.date.slice(8)) <= day).reduce((s, v) => s + v.row.outflowCents, 0), 0) / reference.length : null };
  });
  return { month, from, to, end, observedFrom, available, partial, elapsedDays, summary, included, actualCents, baselineCents, baselineReady: baselineCents !== null, referenceMonths: reference.map(r => r.month), daily };
}
