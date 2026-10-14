import type { Invoice } from "./invoice-model.js";
import type { Insurer } from "./healthcare-evidence.js";
/** An owner statement is an overlay, never a fabricated insurer document. */
export type OwnerAdjudication = { expenseId: string; insurer: Insurer; amount: number | null; reason: string; action: "confirm" | "remove";
  at: string; revision: number; provenance: "owner-confirmed"; invoice: { number: string; serviceDate: string; originalAmount: number }; statement?: string; contextLibraryFileId?: string };
export function latestOwnerAdjudications(history: OwnerAdjudication[] = []): OwnerAdjudication[] {
  const latest = new Map<string, OwnerAdjudication>();
  for (const row of history) {
    if (!row || !row.expenseId || !["desjardins", "blue-cross"].includes(row.insurer) || row.provenance !== "owner-confirmed"
      || !Number.isInteger(row.revision) || row.revision < 1 || !Number.isFinite(Date.parse(row.at))
      || typeof row.reason !== "string" || !row.reason.trim() || row.reason.length > 500
      || !row.invoice || typeof row.invoice.number !== "string" || typeof row.invoice.serviceDate !== "string" || !Number.isFinite(row.invoice.originalAmount)
      || !["confirm", "remove"].includes(row.action) || row.action === "confirm" && (row.amount == null || !Number.isFinite(row.amount) || row.amount < 0))
      throw new Error("Owner adjudication history is unreadable; restore it before preparation.");
    const key = `${row.expenseId}:${row.insurer}`;
    if (!latest.has(key) || latest.get(key)!.revision < row.revision) latest.set(key, row);
  }
  return [...latest.values()];
}
export function ownerAdjudicationApplies(row: OwnerAdjudication, item: Invoice): boolean {
  return row.action === "confirm" && row.expenseId === item.Id && row.invoice.number === item.Healthcare?.InvoiceNumber
    && row.invoice.serviceDate === item.ServiceDate && row.invoice.originalAmount === (item.Healthcare?.OriginalBilledAmount ?? item.BilledAmount);
}
export function withOwnerAdjudications(items: Invoice[], history: OwnerAdjudication[] = []): Invoice[] {
  const confirmed = latestOwnerAdjudications(history).filter(row => row.action === "confirm");
  return items.map(item => {
    const rows = confirmed.filter(row => ownerAdjudicationApplies(row, item));
    if (!rows.length || item.DocumentRole !== "expense") return item;
    const h = { ...item.Healthcare, InsurerPayments: { ...item.Healthcare?.InsurerPayments },
      ProcessedInsurers: [...(item.Healthcare?.ProcessedInsurers || [])], FieldSources: { ...item.Healthcare?.FieldSources }, FieldStates: { ...item.Healthcare?.FieldStates } };
    for (const row of rows) {
      h.InsurerPayments[row.insurer] = row.amount;
      if (!h.ProcessedInsurers.includes(row.insurer)) h.ProcessedInsurers.push(row.insurer);
      h.FieldSources[`InsurerPayments.${row.insurer}`] = "manual";
      h.FieldStates[`InsurerPayments.${row.insurer}`] = "confirmed";
    }
    return { ...item, Healthcare: h };
  });
}
