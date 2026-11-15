import type { FinanceBalanceObservation } from "../../worker/src/finance-model";
import { financeTimestamp } from "../../worker/src/finance-observations";
export type ReceivedBalancePoint = FinanceBalanceObservation & { timestamp: number; changeCents: number | null };
/** Receipt chronology only. Never mixes source-dated history, accounts or currencies. */
export function receivedBalanceEvolution(observations: FinanceBalanceObservation[], accountId: string, currency: string, now = Date.now()) {
    const captures = new Map<number, FinanceBalanceObservation>(), conflicts = new Set<number>();
    let excluded = 0, duplicates = 0;
    for (const row of observations) {
        if (row.accountId !== accountId) continue;
        let timestamp: number;
        try { timestamp = Date.parse(financeTimestamp(row.capturedAt)); } catch { excluded++; continue; }
        if (row.currency !== currency || !/^[A-Z]{3}$/.test(currency) || !Number.isSafeInteger(row.balanceCents) || Math.abs(row.balanceCents) > 1e13 || timestamp > now + 5 * 60_000 || !/^[a-f0-9]{64}$/.test(row.source?.sha256 ?? "")) { excluded++; continue; }
        const existing = captures.get(timestamp);
        if (existing) {
            if (existing.balanceCents !== row.balanceCents || existing.sourceAsOf !== row.sourceAsOf || existing.source.sha256 !== row.source.sha256) conflicts.add(timestamp);
            else duplicates++;
        } else captures.set(timestamp, row);
    }
    const rows = [...captures.entries()].filter(([timestamp]) => !conflicts.has(timestamp)).sort(([a], [b]) => a - b);
    const points: ReceivedBalancePoint[] = rows.map(([timestamp, row], index) => ({ ...row, timestamp, changeCents: index ? row.balanceCents - rows[index - 1][1].balanceCents : null }));
    const comparable = conflicts.size === 0 && points.length >= 2;
    return { points, excluded, duplicates, conflicting: conflicts.size > 0, changeCents: comparable ? points.at(-1)!.balanceCents - points[0].balanceCents : null };
}
