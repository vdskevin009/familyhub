import { ReconciliationCase, ReimbursementCategory, ReimbursementItem, ReimbursementStatus, ReimbursementWorkflowStatus } from "./types";

/** A patient is shown separately; an unknown clinic uses the documented service title. */
export function healthcareTitle(item: { Provider?: string | null; ServiceType?: string | null }): string {
  const patient = /^(?:visa\s+)?(?:kevin(?: henri)?(?: vanderstraeten)?|jas(?:mine)?(?: wing)?|nathan(?: vanderstraeten)?)$/i;
  const provider = item.Provider?.trim();
  return provider && !patient.test(provider) ? provider : item.ServiceType || "Provider to confirm";
}

function autoTriageKnownItem(item: ReimbursementItem): ReimbursementItem {
  if (item.ClassificationSource === "manual") return item;
  const sender = item.Sender.toLowerCase();
  const subject = item.Subject.trim();
  const ignored = sender.includes("notifications@github.com")
    || (sender.includes("janeapp.com") && /^(?:appointment reminder|thanks for booking)$/i.test(subject))
    || (sender.includes("teeon.com") && /booking confirmation/i.test(subject))
    || (sender.includes("communication.microsoft.com") && /terms of use/i.test(subject));
  const administrative = (sender.includes("revolut.com") && /(?:trading t&cs|terms and conditions|t&cs)/i.test(subject))
    || (sender.includes("td.com") && /statement.*available/i.test(subject))
    || sender.includes("crelan.be")
    || (sender.includes("notifications.westjet.com") && /travel with ease/i.test(subject));
  if (!ignored && !administrative) return item;
  const reason = ignored ? "Routine notification filtered from the document queue." : "Administrative notice recognized from sender and subject.";
  return {
    ...item,
    DocumentType: ignored ? "ignore" : "administrative",
    Status: ignored ? ReimbursementStatus.Ignored : ReimbursementStatus.ToReview,
    NeedsReview: false,
    ReimbursementEligibility: "no",
    ClassificationSource: "rules",
    Reasons: [reason, ...(item.Reasons ?? [])].slice(0, 3)
  };
}

export function mergeInvoiceItems(existing: ReimbursementItem[], incoming: ReimbursementItem[]): ReimbursementItem[] {
  const messageKey = (item: ReimbursementItem) => `message:${item.AccountEmail.toLowerCase()}:${item.SourceMessageId}`;
  // One insurer email can contain many independent claim rows. Worker IDs identify rows.
  const keyFor = (item: ReimbursementItem) => item.WorkerManaged ? `id:${item.Id}` : messageKey(item);
  const map = new Map(existing.map(item => [keyFor(item), item]));
  for (const incomingItem of incoming) {
    const next = autoTriageKnownItem(incomingItem);
    const key = keyFor(next);
    const oldBrowserKey = messageKey(next);
    const current = map.get(key) ?? (next.WorkerManaged ? map.get(oldBrowserKey) : undefined);
    if (!next.WorkerManaged && [...map.values()].some(item => item.WorkerManaged && messageKey(item) === oldBrowserKey)) continue;
    if (next.WorkerManaged) map.delete(oldBrowserKey);
    map.set(key, current ? {
      ...next,
      Id: next.WorkerManaged ? next.Id : current.Id,
      Status: next.WorkerManaged && (current.WorkerManaged || next.Status === ReimbursementStatus.Ignored) ? next.Status : current.Status,
      Notes: current.Notes,
      DriveFileId: current.DriveFileId,
      DrivePath: current.DrivePath,
      ArchivedAt: current.ArchivedAt
    } : next);
  }
  return [...map.values()];
}

/** Retain a reviewable trace when a partial or rebuilt worker index omits a case. */
export function mergeReconciliationHistory(previous: ReconciliationCase[], incoming: ReconciliationCase[], items: ReimbursementItem[]): ReconciliationCase[] {
  const currentDocuments = new Set(incoming.flatMap(item => item.DocumentIds));
  const byId = new Map(items.map(item => [item.Id, item]));
  const retained = previous.filter(item => item.DocumentIds.length > 0
    && !item.DocumentIds.some(id => currentDocuments.has(id))
    && byId.get(item.DocumentIds[0])?.Status !== ReimbursementStatus.Ignored)
    .map(item => ({ ...item, PreviouslyFound: true }));
  return [...incoming.map(item => ({ ...item, PreviouslyFound: false })), ...retained];
}

/** Surface indexed healthcare invoices even when no reconciliation case was produced. */
export function unreconciledInvoiceCases(cases: ReconciliationCase[], items: ReimbursementItem[]): ReconciliationCase[] {
  const covered = new Set(cases.flatMap(item => item.DocumentIds));
  const candidates = items.filter(item => (item.Category === ReimbursementCategory.HealthBenefit || item.DocumentRole === "expense" && item.ReimbursementEligibility === "possible")
    && item.Status !== ReimbursementStatus.Ignored && !covered.has(item.Id)
    && (item.DocumentRole === "expense" || (!item.DocumentRole || item.DocumentRole === "other")
      && ["receipt", "invoice", "bill"].includes(item.DocumentType || "")));
  const grouped = new Map<string, ReimbursementItem[]>();
  for (const item of candidates) {
    // Only an explicit shared invoice number justifies consolidating source documents.
    const invoiceNumber = item.Healthcare?.InvoiceNumber?.trim().toLowerCase();
    const key = invoiceNumber ? `${item.Member || "unknown"}:${item.ServiceDate || "unknown"}:${invoiceNumber}` : item.Id;
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }
  return [...grouped.values()].map(group => {
    const item = group.find(entry => entry.BilledAmount != null) ?? group[0];
    return {
      Id: `unreconciled:${item.Id}`, DocumentIds: group.map(entry => entry.Id), Member: item.Member || "unknown",
      Provider: item.Healthcare?.Provider || item.Provider, ServiceType: item.Healthcare?.ServiceType || item.ClaimedService,
      ServiceDate: item.ServiceDate || null,
      OriginalAmount: item.BilledAmount ?? item.DetectedAmount, ReimbursedAmount: 0, PotentialRemaining: null,
      Currency: item.Currency || "CAD", NextInsurer: null, Action: "review-amount" as const,
      Status: "needs-attention" as const, Summary: "Indexed invoice without a confirmed reconciliation case.",
      Confidence: item.Confidence, PreviouslyFound: true, Unreconciled: true
    };
  });
}

export type InvoiceHistoryFilter = "fully-reimbursed" | "not-fully-reimbursed" | "primary" | "secondary";
export type ReimbursementCaseStatus = NonNullable<ReconciliationCase["Status"]>;
export type ReimbursementPersonScope = "all" | "Kevin" | "Jasmine" | "Nathan";
export type WorkflowStatusFilter = ReimbursementWorkflowStatus | "all";

export function reimbursementWorkflowStatus(item: ReconciliationCase): ReimbursementWorkflowStatus {
  if (item.WorkflowStatus) return item.WorkflowStatus;
  return reimbursementCaseStatus(item) === "fully-reimbursed" ? "closed" : "open";
}

export function filterReimbursementWorkflowCases(cases: ReconciliationCase[], scope: ReimbursementPersonScope,
  workflow: WorkflowStatusFilter): ReconciliationCase[] {
  return cases.filter(item => (scope === "all" || item.Member === scope)
    && (workflow === "all" || reimbursementWorkflowStatus(item) === workflow));
}

export function reimbursementWorkflowSummary(cases: ReconciliationCase[], scope: ReimbursementPersonScope): { open: number; potentiallyRecoverable: number } {
  const openCases = cases.filter(item => (scope === "all" || item.Member === scope) && reimbursementWorkflowStatus(item) === "open");
  return {
    open: openCases.length,
    potentiallyRecoverable: Math.round(openCases.reduce((sum, item) => sum + Math.max(0, item.PotentialRemaining ?? 0), 0) * 100) / 100
  };
}

export function reimbursementCaseStatus(item: ReconciliationCase): ReimbursementCaseStatus {
  if (item.PreviouslyFound) return "needs-attention";
  if (item.Status) return item.Status;
  if (item.Action === "complete") return "fully-reimbursed";
  if (item.Action === "submit-primary") return "waiting-primary";
  if (item.Action === "submit-secondary") return "waiting-secondary";
  return "needs-attention";
}

export function primaryReimbursementAmount(item: ReconciliationCase): number | null {
  if ("PrimaryReimbursedAmount" in item) return item.PrimaryReimbursedAmount ?? null;
  return item.Action === "submit-secondary" ? item.ReimbursedAmount : 0;
}

export function secondaryReimbursementAmount(item: ReconciliationCase): number | null {
  if ("SecondaryReimbursedAmount" in item) return item.SecondaryReimbursedAmount ?? null;
  return 0;
}

export function namedInsurerReimbursementAmount(item: ReconciliationCase, insurer: "Desjardins" | "Blue Cross",
  itemsById?: ReadonlyMap<string, ReimbursementItem>): number | null {
  const explicit = insurer === "Desjardins" ? item.DesjardinsReimbursedAmount : item.BlueCrossReimbursedAmount;
  if (explicit != null) return explicit;
  if (item.PrimaryInsurer === insurer && "PrimaryReimbursedAmount" in item) return item.PrimaryReimbursedAmount ?? null;
  if (item.SecondaryInsurer === insurer && "SecondaryReimbursedAmount" in item) return item.SecondaryReimbursedAmount ?? null;
  if (!itemsById) return null;
  const insurerKey = insurer === "Desjardins" ? "desjardins" : "blue-cross";
  const assignments = (item.MatchAssignments ?? []).filter(match => match.Insurer === insurerKey);
  if (!assignments.length) return null;
  const amounts = assignments.map(match => {
    const reimbursement = itemsById.get(match.ReimbursementDocumentId);
    return reimbursement?.ReimbursedAmount ?? reimbursement?.DetectedAmount ?? null;
  });
  if (amounts.some(amount => amount == null)) return null;
  return Math.round(amounts.reduce((sum, amount) => sum + (amount ?? 0), 0) * 100) / 100;
}

function invoiceHistoryDateValue(value: string | null | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

/**
 * Build the complete visible reimbursement history without mutating the persisted data.
 * Sorting is presentation-only: it must never remove an already indexed invoice.
 */
export function buildInvoiceHistoryCases(reconciliations: ReconciliationCase[], items: ReimbursementItem[]): ReconciliationCase[] {
  const byId = new Map(items.map(item => [item.Id, item]));
  const caseDate = (item: ReconciliationCase) => item.ServiceDate || byId.get(item.DocumentIds[0])?.ServiceDate
    || byId.get(item.DocumentIds[0])?.ReceivedAt;
  return [...reconciliations, ...unreconciledInvoiceCases(reconciliations, items)]
    .filter(item => reimbursementWorkflowStatus(item) === "ignore" || !item.DocumentIds.some(id => byId.get(id)?.IgnoredAt))
    .sort((a, b) => invoiceHistoryDateValue(caseDate(b)) - invoiceHistoryDateValue(caseDate(a)) || a.Id.localeCompare(b.Id));
}

/** Filters are a temporary view over history; clearing them restores the complete input set. */
export function filterInvoiceHistoryCases(cases: ReconciliationCase[], filters: ReadonlySet<InvoiceHistoryFilter>): ReconciliationCase[] {
  const hasStatusFilter = filters.has("fully-reimbursed") || filters.has("not-fully-reimbursed");
  const hasSourceFilter = filters.has("primary") || filters.has("secondary");

  return cases.filter(item => {
    const status = reimbursementCaseStatus(item);
    const statusMatches = !hasStatusFilter
      || (filters.has("fully-reimbursed") && status === "fully-reimbursed")
      || (filters.has("not-fully-reimbursed") && status !== "fully-reimbursed");
    const sourceMatches = !hasSourceFilter
      || (filters.has("primary") && (primaryReimbursementAmount(item) ?? 0) > 0)
      || (filters.has("secondary") && (secondaryReimbursementAmount(item) ?? 0) > 0);
    return statusMatches && sourceMatches;
  });
}

