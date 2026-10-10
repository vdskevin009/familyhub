export type PeriodMode = "month" | "year" | "custom";
export type DateRange = { from: string; to: string };
const iso = (date: Date) => date.toISOString().slice(0, 10);
export function calendarPeriod(year: number, month?: number): DateRange {
    const start = new Date(Date.UTC(year, month === undefined ? 0 : month - 1, 1, 12));
    const end = new Date(Date.UTC(year, month === undefined ? 12 : month, 0, 12));
    return { from: iso(start), to: iso(end) };
}
export function periodMode({ from, to }: DateRange): PeriodMode {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return "custom";
    const [year, month] = from.split("-").map(Number);
    const annual = calendarPeriod(year), monthly = calendarPeriod(year, month);
    return from === annual.from && to === annual.to ? "year" : from === monthly.from && to === monthly.to ? "month" : "custom";
}
export function shiftPeriod(range: DateRange, direction: -1 | 1): DateRange {
    const mode = periodMode(range);
    if (mode === "custom") return range;
    const [year, month] = range.from.split("-").map(Number);
    if (mode === "year") return calendarPeriod(year + direction);
    const date = new Date(Date.UTC(year, month - 1 + direction, 1, 12));
    return calendarPeriod(date.getUTCFullYear(), date.getUTCMonth() + 1);
}
export function defaultPeriod(scope?: DateRange): DateRange {
    const date = new Date((scope?.to ?? new Date().toISOString().slice(0, 10)) + "T12:00:00Z");
    if (scope?.to === calendarPeriod(date.getUTCFullYear(), date.getUTCMonth() + 1).to) return calendarPeriod(date.getUTCFullYear(), date.getUTCMonth() + 1);
    date.setUTCDate(0);
    const result = calendarPeriod(date.getUTCFullYear(), date.getUTCMonth() + 1);
    return scope && result.to < scope.from ? calendarPeriod(Number(scope.to.slice(0, 4)), Number(scope.to.slice(5, 7))) : result;
}
export function rangeLabel(range: DateRange): string {
    const mode = periodMode(range), year = Number(range.from.slice(0, 4));
    return mode === "year" ? String(year) : mode === "month" ? new Intl.DateTimeFormat("fr-CA", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(range.from + "T12:00:00Z")) : `${range.from} – ${range.to}`;
}
