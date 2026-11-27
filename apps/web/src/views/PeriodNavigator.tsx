import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { calendarPeriod, periodMode, shiftPeriod, rangeLabel, type DateRange, type PeriodMode } from "../finance-periods";

export default function PeriodNavigator({ range, onChange, scope, label = "Period" }: {
    range: DateRange;
    onChange: (range: DateRange) => void;
    scope?: DateRange;
    label?: string;
}) {
    const mode = periodMode(range), signature = JSON.stringify(range);
    // Keep date inputs visible during manual edits; a chart drill-down resets this mode.
    const [customRange, setCustomRange] = useState<string | null>(mode === "custom" ? signature : null);
    const selectedMode = customRange === signature ? "custom" : mode;
    const anchor = /^\d{4}-\d{2}/.test(range.to) ? range.to : new Date().toISOString().slice(0, 10);
    const year = Number(anchor.slice(0, 4)), month = Number(anchor.slice(5, 7));
    const first = Math.min(Number(scope?.from.slice(0, 4) ?? year), year);
    const last = Math.max(Number(scope?.to.slice(0, 4) ?? year), year);
    const years = Array.from({ length: Math.min(101, last - first + 1) }, (_, i) => last - i);
    const previous = shiftPeriod(range, -1), next = shiftPeriod(range, 1);
    const change = (value: DateRange) => { setCustomRange(null); onChange(value); };
    const customChange = (value: DateRange) => { setCustomRange(JSON.stringify(value)); onChange(value); };
    return <fieldset className="period-navigator">
        <legend>{label}</legend>
        <div className="period-controls">
            <label>View
                <select aria-label="View" value={selectedMode} onChange={e => {
                    const value = e.target.value as PeriodMode;
                    if (value === "custom") setCustomRange(signature);
                    else change(calendarPeriod(year, value === "month" ? mode === "year" ? Number((scope?.to ?? new Date().toISOString()).slice(5, 7)) : month : undefined));
                }}>
                    <option value="month">Month</option><option value="year">Year</option><option value="custom">Custom dates</option>
                </select>
            </label>
            {selectedMode !== "custom" && <>
                <label>Year<select aria-label="Year" value={year} onChange={e => change(calendarPeriod(Number(e.target.value), selectedMode === "month" ? month : undefined))}>{years.map(y => <option key={y}>{y}</option>)}</select></label>
                {selectedMode === "month" && <label>Month<select aria-label="Month" value={month} onChange={e => change(calendarPeriod(year, Number(e.target.value)))}>{Array.from({ length: 12 }, (_, i) => <option value={i + 1} key={i}>{new Intl.DateTimeFormat("en-CA", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2024, i, 1)))}</option>)}</select></label>}
            </>}
        </div>
        {selectedMode === "custom" ? <div className="period-controls">
            <label>From<input type="date" value={range.from} onChange={e => customChange({ ...range, from: e.target.value })} /></label>
            <label>To<input type="date" value={range.to} onChange={e => customChange({ ...range, to: e.target.value })} /></label>
        </div> : <div className="period-navigation">
            <button className="button secondary" type="button" aria-label={mode === "year" ? "Previous year" : "Previous month"} disabled={Boolean(scope && previous.to < scope.from)} onClick={() => change(previous)}><ChevronLeft size={18} /></button>
            <strong aria-live="polite">{rangeLabel(range)}</strong>
            <button className="button secondary" type="button" aria-label={mode === "year" ? "Next year" : "Next month"} disabled={Boolean(scope && next.from > scope.to)} onClick={() => change(next)}><ChevronRight size={18} /></button>
        </div>}
        {scope && <small>Reported coverage: {scope.from} to {scope.to}. Amounts are not extrapolated for incomplete months.</small>}
    </fieldset>;
}
