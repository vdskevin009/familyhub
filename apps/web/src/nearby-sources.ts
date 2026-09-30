import { libraryItems, type DocumentLibraryKind } from "./document-library";
import type { ReconciliationCase, ReimbursementItem } from "./types";
import { manualMatchExpenseId, manualMatchUnavailableReason } from "./reconciliation-triage";

export const sourceLabels: Record<DocumentLibraryKind, string> = { invoices: "Invoices", desjardins: "Desjardins", "blue-cross": "Blue Cross" };

const blockedLink = (reason: string) => ({ reason, target: null, reimbursement: null });

/** Shared validation for both directions of an explicit nearby-record link. */
function paymentLink(target: ReconciliationCase, reimbursement: ReimbursementItem, cases: ReconciliationCase[],
  unmatchedIds: ReadonlySet<string>, ignoredIds: ReadonlySet<string>) {
  if (reimbursement.DocumentRole !== "insurer-statement" || !["desjardins", "blue-cross"].includes(reimbursement.Insurer || ""))
    return blockedLink("Select an insurer reimbursement record.");
  if (target.WorkflowStatus === "ignore" || reimbursement.IgnoredAt || reimbursement.Status === 4 || ignoredIds.has(reimbursement.Id))
    return blockedLink("Restore the ignored record before linking.");
  const linked = cases.filter(entry => !entry.PreviouslyFound && entry.MatchAssignments?.some(match => match.ReimbursementDocumentId === reimbursement.Id));
  if (linked.length) return blockedLink(linked.some(entry => entry.Id === target.Id)
    ? "Already linked to this claim." : "Linked to another claim. Review and reject that existing match before linking here.");
  if (!unmatchedIds.has(reimbursement.Id)) return blockedLink("This payment is no longer unmatched. Refresh before linking.");
  const reason = manualMatchUnavailableReason(reimbursement, target);
  if (reason) return blockedLink(reason);
  if (target.MatchAssignments?.some(match => match.Insurer === reimbursement.Insurer))
    return blockedLink("This expense already has a payment from this insurer. Review its existing match first.");
  return { reason: null, target, reimbursement };
}

/** Link a selected insurer-tab row to the current expense-backed claim. */
export function nearbyReimbursementLink(claim: ReconciliationCase, reimbursement: ReimbursementItem,
  cases: ReconciliationCase[], unmatchedIds: ReadonlySet<string>, ignoredIds: ReadonlySet<string>) {
  const expenseId = manualMatchExpenseId(claim);
  if (!expenseId) return blockedLink("Link an original invoice first, then add its insurer reimbursement.");
  const targets = cases.filter(entry => !entry.PreviouslyFound && !entry.InferredFromInsurer && !entry.Unreconciled
    && (entry.ExpenseDocumentId === expenseId || entry.ExpenseDocumentIds?.includes(expenseId)));
  if (targets.length !== 1) return blockedLink("A unique current expense is required. Refresh and review its links.");
  return paymentLink(targets[0], reimbursement, cases, unmatchedIds, ignoredIds);
}

/** An explicit link moves one unmatched payment to a real expense; it never merges other claims. */
export function nearbyInvoiceLink(claim: ReconciliationCase, invoice: ReimbursementItem,
  items: ReimbursementItem[], cases: ReconciliationCase[], unmatchedIds: ReadonlySet<string>, ignoredIds: ReadonlySet<string>) {
  const blocked = blockedLink;
  if (!claim.InferredFromInsurer || !claim.OriginalInvoiceMissing || claim.PreviouslyFound)
    return blocked("This claim already has an expense. Review its existing links first.");
  if (claim.DocumentIds.length !== 1) return blocked("Review the individual insurer records before linking.");
  const reimbursement = items.find(item => item.Id === claim.DocumentIds[0]);
  if (!reimbursement || !unmatchedIds.has(reimbursement.Id)) return blocked("This payment is no longer unmatched. Refresh before linking.");
  if (claim.WorkflowStatus === "ignore" || [invoice, reimbursement].some(item => item.IgnoredAt || item.Status === 4 || ignoredIds.has(item.Id)))
    return blocked("Restore the ignored record before linking.");
  if (!libraryItems([invoice], "invoices").length) return blocked("Select an original invoice.");
  const targets = cases.filter(entry => !entry.PreviouslyFound && !entry.InferredFromInsurer && !entry.Unreconciled
    && (entry.ExpenseDocumentId === invoice.Id || entry.ExpenseDocumentIds?.includes(invoice.Id)));
  if (targets.length !== 1) return blocked("A unique current expense is required. Refresh and review its links.");
  return paymentLink(targets[0], reimbursement, cases, unmatchedIds, ignoredIds);
}

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
