import { classifiedRows, expenseCategories, summarizeSpending, type FinanceState } from "../../worker/src/finance-model";

export const baselineWindowMonths = 6;
export const minimumBaselineMonths = 3;
const pad = (n: number) => String(n).padStart(2, "0");
export function localToday() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
export function shiftMonth(month: string, offset: number) {
    const [year, index] = month.split("-").map(Number), d = new Date(Date.UTC(year, index - 1 + offset, 1));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}
export function monthEnd(month: string) {
    const [year, index] = month.split("-").map(Number);
    return `${month}-${pad(new Date(Date.UTC(year, index, 0)).getUTCDate())}`;
}
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

/** Observed personal history only. Coverage bounds are a gate, never a completeness certificate. */
export function spendingTrend(state: FinanceState, month: string, accountId = "", currency = "CAD", today = localToday()) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Mois invalide");
    const data = state.data, from = month + "-01", end = monthEnd(month);
    const asOf = [today, data?.scope.to ?? "", data?.collectedOn ?? ""].sort()[0];
    const to = end < asOf ? end : asOf;
    const future = from > today, available = Boolean(data && to >= from && data.scope.from <= end);
    const partial = available && to < end;
    const elapsedDays = available ? Number(to.slice(8, 10)) : 0;
    const allRows = classifiedRows(state);
    const accounts = (data?.accounts ?? []).filter(a => a.currency === currency && (accountId ? a.id === accountId :
        ["bank", "credit-card"].includes(a.type) || allRows.some(r => r.accountId === a.id && r.status === "posted" && r.currency === currency && r.category !== "savings-investments" && ["expense", "refund"].includes(r.nature))));
    function coverage(start: string, finish: string): string[] {
        const reasons: string[] = [];
        if (!data || data.scope.from > start || data.scope.to < finish || data.collectedOn < finish) reasons.push("Période hors des bornes de l'import");
        if (!accounts.length) reasons.push("Aucun compte de dépenses documenté pour ce filtre");
        for (const account of accounts) {
            const bounds = data?.coverage.filter(c => c.accountId === account.id) ?? [];
            // Do not join disconnected source intervals and accidentally fill a gap.
            if (!bounds.some(c => c.earliest && c.latest && c.earliest <= start && c.latest >= finish)) reasons.push(`${account.name} : dates importées insuffisantes pour cette période`);
        }
        return reasons;
    }
    const reasons = available ? coverage(from, to) : [future ? "Mois à venir" : "Aucune période importée disponible"];
    const summary = summarizeSpending(state, from, available ? to : from, accountId, currency);
    const comparable = available && reasons.length === 0;
    // Missing coverage with no actual expense rows is unknown, not an invented zero.
    const actualCents = available && (comparable || summary.included.length > 0) ? summary.totalCents : null;
    const candidates = Array.from({ length: baselineWindowMonths }, (_, index) => {
        const previous = shiftMonth(month, -baselineWindowMonths + index), last = monthEnd(previous);
        const problems = coverage(previous + "-01", last);
        if (last >= from || last > today) problems.push("Le mois cible et les mois futurs sont exclus");
        if (partial && Number(last.slice(8)) < elapsedDays) problems.push("Mois trop court pour comparer le même nombre de jours");
        const comparisonTo = partial ? `${previous}-${pad(Math.min(elapsedDays, Number(last.slice(8))))}` : last;
        return { month: previous, from: previous + "-01", to: last, comparisonTo, reasons: problems,
            summary: summarizeSpending(state, previous + "-01", comparisonTo, accountId, currency) };
    });
    const qualified = candidates.filter(c => !c.reasons.length);
    const baselineReady = comparable && qualified.length >= minimumBaselineMonths;
    const baselineCents = baselineReady ? mean(qualified.map(c => c.summary.totalCents)) : null;
    const categories = Object.keys(expenseCategories).filter(key => key !== "savings-investments").map(key => {
        const current = summary.categories.find(c => c.key === key)!;
        const typical = baselineReady ? mean(qualified.map(c => c.summary.categories.find(row => row.key === key)!.cents)) : null;
        return { key: current.key, label: expenseCategories[current.key], actualCents: actualCents === null ? null : current.cents,
            count: available ? current.count : 0, baselineCents: typical,
            baselineCount: qualified.reduce((sum, c) => sum + c.summary.categories.find(row => row.key === key)!.count, 0) };
    }).filter(c => c.count || (baselineReady && c.baselineCount));
    const chartDays = partial || !baselineReady ? elapsedDays : Math.max(elapsedDays, ...qualified.map(c => Number(c.to.slice(8))));
    const daily = Array.from({ length: chartDays }, (_, index) => {
        const day = index + 1;
        const sumTo = (rows: typeof summary.included) => rows.filter(r => Number(r.date.slice(8)) <= day).reduce((sum, r) => sum + r.outflowCents, 0);
        return { day, actualCents: actualCents === null || day > elapsedDays ? null : sumTo(summary.included), baselineCents: baselineReady ? mean(qualified.map(c => sumTo(c.summary.included))) : null };
    });
    return { month, from, to: available ? to : end, end, elapsedDays, partial, future, available, comparable, reasons, actualCents,
        baselineCents, baselineReady, candidates, qualifiedMonths: qualified.map(c => c.month), categories, daily, summary, accounts,
        coverage: accounts.map(a => ({ account: a.name, rows: data?.coverage.filter(c => c.accountId === a.id) ?? [] })),
        warnings: [...new Set(accounts.flatMap(a => (data?.coverage.filter(c => c.accountId === a.id) ?? []).map(c => c.warning).filter((s): s is string => Boolean(s))))],
        pendingCount: data?.pendingCount ?? 0,
        pendingRows: (data?.transactions ?? []).filter(r => r.status === "pending" && (!accountId || r.accountId === accountId) && r.currency === currency && r.date >= from && r.date <= end),
    };
}
export type SpendingTrend = ReturnType<typeof spendingTrend>;
