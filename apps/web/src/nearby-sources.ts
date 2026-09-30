import { libraryItems, type DocumentLibraryKind } from "./document-library";
import type { ReconciliationCase, ReimbursementItem } from "./types";

export const sourceLabels: Record<DocumentLibraryKind, string> = { invoices: "Invoices", desjardins: "Desjardins", "blue-cross": "Blue Cross" };

function day(value: string | null | undefined): number | null {
  const date = value?.slice(0, 10);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const time = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date ? time / 86400000 : null;
}

/** Read-only library lookup, deliberately independent of match score and workflow status. */
export function nearbySourceRecords(claim: ReconciliationCase, kind: DocumentLibraryKind,
  items: ReimbursementItem[], cases: ReconciliationCase[]) {
  const center = day(claim.ServiceDate);
  const knownMember = Boolean(claim.Member && claim.Member !== "unknown");
  const sources = libraryItems(items, kind).filter(item => knownMember && item.Member === claim.Member);
  const dateFor = (item: ReimbursementItem) => item.ServiceDate || item.Healthcare?.ServiceDate;
  const rows = center == null || !knownMember ? [] : sources.flatMap(item => {
    const date = day(dateFor(item));
    if (date == null || Math.abs(date - center) > 10) return [];
    const links = cases.filter(entry => !entry.PreviouslyFound && !entry.InferredFromInsurer && !entry.Unreconciled
      && (kind === "invoices"
        ? entry.ExpenseDocumentId === item.Id || entry.ExpenseDocumentIds?.includes(item.Id) || entry.DocumentIds.includes(item.Id)
        : entry.MatchAssignments?.some(match => match.ReimbursementDocumentId === item.Id)));
    return [{ item, serviceDate: dateFor(item)!, offsetDays: date - center, links }];
  }).sort((a, b) => Math.abs(a.offsetDays) - Math.abs(b.offsetDays) || a.serviceDate.localeCompare(b.serviceDate) || a.item.Id.localeCompare(b.item.Id));
  return {
    rows, missingDates: sources.filter(item => day(dateFor(item)) == null).length,
    unavailable: !knownMember ? "Confirm the family member to compare nearby records." : center == null ? "Confirm the service date to compare nearby records." : null,
    from: center == null ? null : new Date((center - 10) * 86400000).toISOString().slice(0, 10),
    to: center == null ? null : new Date((center + 10) * 86400000).toISOString().slice(0, 10)
  };
}
