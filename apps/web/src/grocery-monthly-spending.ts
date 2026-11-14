import { receiptSourceType, type GroceryRecord } from "../../worker/src/grocery-model";

export type PcExpressMonth = { month: string; currency: string; paid: number; estimated: number; paidCount: number; estimatedCount: number };
const isDate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s + "T12:00:00Z")) && new Date(s + "T12:00:00Z").toISOString().slice(0, 10) === s;
export function pcExpressMonthlySpending(records: GroceryRecord[]) {
  const eligible = records.filter(r => r.status === "saved" && !r.duplicateOf && (r.automaticImport?.kind === "pc-express-gmail" || /\bpc\s*(?:express|x)\b|pcexpress\.ca/i.test([r.receipt.store, ...r.sources.map(s => s.name)].join(" "))));
  const orders = new Map<string, GroceryRecord[]>();
  let ambiguous = 0;
  for (const record of eligible) {
    // Only an explicit order reference establishes cross-mailbox identity, never matching prices/dates/names.
    const ids = [...new Set([record.automaticImport?.orderId, ...record.receipt.reference.matchAll(/(?<!\d)\d{15}(?!\d)/g)].map(v => typeof v === "string" ? v : v?.[0]).filter((v): v is string => !!v && /^\d{15}$/.test(v)))];
    if (ids.length > 1) { ambiguous++; continue; }
    const key = ids.length === 1 ? `order:${ids[0]}` : `record:${record.id}`;
    orders.set(key, [...(orders.get(key) || []), record]);
  }
  const months = new Map<string, PcExpressMonth>();
  let excluded = 0, conflicts = ambiguous, duplicates = 0;
  const dates: string[] = [];
  for (const group of orders.values()) {
    const finals = group.filter(r => receiptSourceType(r) === "final-receipt" && !!r.reviewedAt);
    const estimates = group.filter(r => receiptSourceType(r) === "confirmation");
    const selected = finals.length ? finals : estimates;
    const valid = selected.filter(r => isDate(r.receipt.date) && /^[A-Z]{3}$/.test(r.receipt.currency || "") && r.receipt.total !== null && Number.isFinite(r.receipt.total) && r.receipt.total >= 0);
    if (!valid.length || valid.length !== selected.length) { excluded++; continue; }
    // Contradictory sources remain out of the aggregate instead of silently choosing a later amount.
    const fingerprints = new Set(valid.map(r => JSON.stringify([r.receipt.date, r.receipt.currency, r.receipt.total])));
    if (fingerprints.size !== 1) { conflicts++; continue; }
    const r = valid[0], date = r.receipt.date!, currency = r.receipt.currency!, month = date.slice(0, 7), key = month + currency;
    const row = months.get(key) || { month, currency, paid: 0, estimated: 0, paidCount: 0, estimatedCount: 0 };
    const cents = Math.round(r.receipt.total! * 100);
    if (finals.length) { row.paid += cents; row.paidCount++; } else { row.estimated += cents; row.estimatedCount++; }
    months.set(key, row); dates.push(date); duplicates += group.length - 1;
  }
  dates.sort();
  return { months: [...months.values()].map(m => ({ ...m, paid: m.paid / 100, estimated: m.estimated / 100 })).sort((a, b) => a.month.localeCompare(b.month) || a.currency.localeCompare(b.currency)), excluded, conflicts, duplicates, firstDate: dates[0] || null, lastDate: dates.at(-1) || null, sourceCount: eligible.length };
}
