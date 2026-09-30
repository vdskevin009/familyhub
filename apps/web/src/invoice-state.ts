import { ReconciliationCase, ReimbursementCategory, ReimbursementItem, ReimbursementStatus, ReimbursementWorkflowStatus, UnmatchedReimbursement } from "./types";

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

export type ReimbursementEvidenceSource = "Email" | "Blue Cross" | "Desjardins";

function insurerDisplayName(insurer: ReimbursementItem["Insurer"]): "Blue Cross" | "Desjardins" | null {
  if (insurer === "blue-cross") return "Blue Cross";
  if (insurer === "desjardins") return "Desjardins";
  return null;
}

function trustedInsurerExpenseEvidence(item: ReimbursementItem): { original: number; paid: number } | null {
  if (item.DocumentRole !== "insurer-statement" || !item.Insurer || item.NeedsReview
    || item.Status === ReimbursementStatus.Ignored || item.Member === "unknown" || !item.ServiceDate) return null;
  const structured = Boolean(item.StructuredSource || item.AccountLabel === "Local Desjardins import" || item.Healthcare?.SubmittedAmount != null);
  const original = item.Healthcare?.SubmittedAmount ?? item.BilledAmount ?? null;
  const paid = item.ReimbursedAmount ?? null;
  if (!structured || original == null || paid == null || original <= 0 || paid < 0 || paid > original + .01) return null;
  return { original, paid };
}

/**
 * Presentation-only expense projection for a trusted insurer row that already proves the
 * original/submitted service amount. This does not create a worker match or mutate source data.
 */
export function insurerEvidenceExpenseCases(cases: ReconciliationCase[], unmatched: UnmatchedReimbursement[],
  items: ReimbursementItem[]): ReconciliationCase[] {
  const byId = new Map(items.map(item => [item.Id, item]));
  const covered = new Set(cases.flatMap(item => item.DocumentIds));
  const projected: ReconciliationCase[] = [];
  for (const result of unmatched) {
    if (covered.has(result.DocumentId)) continue;
    const source = byId.get(result.DocumentId);
    if (!source) continue;
    const evidence = trustedInsurerExpenseEvidence(source);
    const insurer = insurerDisplayName(source.Insurer);
    if (!evidence || !insurer) continue;
    const remaining = Math.round(Math.max(0, evidence.original - evidence.paid) * 100) / 100;
    const closed = remaining <= .005;
    const ignored = Boolean(result.IgnoredAt);
    const provider = source.Healthcare?.Provider
      || source.ClaimedService
      || source.Provider.replace(/^(?:Blue Cross|Desjardins)\s*·\s*/i, "")
      || "Provider to confirm";
    projected.push({
      Id: `insurer-evidence:${source.Id}`,
      DocumentIds: [source.Id],
      Member: source.Member || "unknown",
      Provider: provider,
      ServiceType: source.Healthcare?.ServiceType || source.ClaimedService || null,
      ServiceDate: source.ServiceDate || null,
      OriginalAmount: evidence.original,
      ReimbursedAmount: evidence.paid,
      PotentialRemaining: remaining,
      Currency: source.Currency || "CAD",
      PrimaryInsurer: null,
      PrimaryReimbursedAmount: null,
      SecondaryInsurer: null,
      SecondaryReimbursedAmount: null,
      DesjardinsReimbursedAmount: source.Insurer === "desjardins" ? evidence.paid : null,
      BlueCrossReimbursedAmount: source.Insurer === "blue-cross" ? evidence.paid : null,
      NextInsurer: null,
      Action: closed ? "complete" : "verify-balance",
      Status: closed ? "fully-reimbursed" : "needs-attention",
      Summary: `Expense established from ${insurer} reimbursement evidence; original invoice not found.`,
      Confidence: source.Confidence,
      WorkflowStatus: ignored ? "ignore" : closed ? "closed" : "open",
      WorkflowOrigin: ignored ? "manual" : "automatic",
      WorkflowChangedAt: result.IgnoredAt,
      AutomaticWorkflowStatus: closed ? "closed" : "open",
      WorkflowHistory: result.IgnoredAt ? [{ Status: "ignore", Origin: "manual", At: result.IgnoredAt, Reason: "manual-override" }] : [],
      InferredFromInsurer: true,
      OriginalInvoiceMissing: true
    });
  }
  return projected;
}

export function reimbursementEvidenceSources(item: ReconciliationCase,
  itemsById: ReadonlyMap<string, ReimbursementItem>): ReimbursementEvidenceSource[] {
  const documents = reimbursementCaseDocuments(item, itemsById);
  const sources = new Set<ReimbursementEvidenceSource>();
  if (documents.some(document => isExpenseDocument(document)
    && !document.StructuredSource
    && document.AccountEmail?.trim()
    && document.SourceMessageId?.trim()
    && document.AccountLabel !== "Local Desjardins import")) sources.add("Email");

  const hasInsurer = (key: "desjardins" | "blue-cross", label: "Desjardins" | "Blue Cross") =>
    (key === "desjardins" ? item.DesjardinsReimbursedAmount != null : item.BlueCrossReimbursedAmount != null)
    || item.PrimaryInsurer === label || item.SecondaryInsurer === label
    || (item.MatchAssignments ?? []).some(match => match.Insurer === key)
    || documents.some(document => document.DocumentRole === "insurer-statement" && document.Insurer === key);
  if (hasInsurer("blue-cross", "Blue Cross")) sources.add("Blue Cross");
  if (hasInsurer("desjardins", "Desjardins")) sources.add("Desjardins");
  return ["Email", "Blue Cross", "Desjardins"].filter(source => sources.has(source as ReimbursementEvidenceSource)) as ReimbursementEvidenceSource[];
}

export function reimbursementActionLabel(item: ReconciliationCase): string {
  const workflow = reimbursementWorkflowStatus(item);
  if (workflow === "ignore") return "Ignored — no active reimbursement review";
  if (workflow === "closed") return "No reimbursement action needed";
  if (item.InferredFromInsurer && (item.PotentialRemaining ?? 0) > .005) return "Check other insurer reimbursement";
  if (item.Action === "submit-primary") return item.NextInsurer ? `Submit to ${item.NextInsurer}` : "Submit to primary insurer";
  if (item.Action === "submit-secondary") return item.NextInsurer ? `Check ${item.NextInsurer} reimbursement` : "Check secondary reimbursement";
  if (item.Status === "waiting-secondary") return "Check secondary reimbursement";
  if (item.Status === "waiting-primary") return "Check primary reimbursement";
  if (item.Status === "patient-balance") return "Review remaining patient balance";
  return "Review reimbursement details";
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

export function reimbursementWorkflowSummary(cases: ReconciliationCase[], scope: ReimbursementPersonScope): { open: number; potentiallyRecoverable: number; knownAmounts: number; unknownAmounts: number } {
  const openCases = cases.filter(item => (scope === "all" || item.Member === scope) && reimbursementWorkflowStatus(item) === "open");
  const known = openCases.filter(item => !item.PreviouslyFound && item.PotentialRemaining != null && Number.isFinite(item.PotentialRemaining));
  return {
    open: openCases.length,
    knownAmounts: known.length,
    unknownAmounts: openCases.length - known.length,
    potentiallyRecoverable: Math.round(known.reduce((sum, item) => sum + Math.max(0, item.PotentialRemaining!), 0) * 100) / 100
  };
}

/**
 * Remove stale unmatched projections when the same insurer document is already assigned
 * to a reconciliation case. The assignment graph is authoritative for matched/unmatched
 * exclusivity; this does not create any new match.
 */
export function excludeAssignedUnmatched<T extends { DocumentId: string }>(unmatched: T[], cases: ReconciliationCase[]): T[] {
  const assigned = new Set(cases.flatMap(item => (item.MatchAssignments ?? []).map(match => match.ReimbursementDocumentId)));
  return unmatched.filter(item => !assigned.has(item.DocumentId));
}

export type ReimbursementInvoicePdfOption = {
  ItemId: string;
  AttachmentIndex: number;
  FileName: string;
  Source: "drive" | "worker";
  Url?: string;
};

function reimbursementPdfAttachmentIndexes(item: ReimbursementItem): number[] {
  return item.Attachments
    .map((attachment, index) => ({ attachment, index }))
    .filter(({ attachment }) => attachment.MimeType === "application/pdf" || /\.pdf$/i.test(attachment.FileName))
    .map(({ index }) => index);
}

function reimbursementCaseDocuments(item: ReconciliationCase,
  itemsById: ReadonlyMap<string, ReimbursementItem>): ReimbursementItem[] {
  const preferredIds = [
    ...(item.ExpenseDocumentIds ?? []),
    ...(item.ExpenseDocumentId ? [item.ExpenseDocumentId] : []),
    ...item.DocumentIds
  ];
  const seen = new Set<string>();
  return preferredIds
    .filter(id => !seen.has(id) && seen.add(id))
    .map(id => itemsById.get(id))
    .filter((entry): entry is ReimbursementItem => Boolean(entry));
}

function isExpenseDocument(item: ReimbursementItem): boolean {
  return item.DocumentRole === "expense"
    || (!item.DocumentRole || item.DocumentRole === "other")
      && ["receipt", "invoice", "bill"].includes(item.DocumentType || "");
}

/**
 * Resolve invoice PDFs without assuming where the file is stored.
 * Prefer actual expense source documents and a durable Drive reference when one exists.
 * Worker PDFs remain private and are fetched through the authenticated attachment endpoint.
 */
export function reimbursementInvoicePdfOptions(item: ReconciliationCase,
  itemsById: ReadonlyMap<string, ReimbursementItem>): ReimbursementInvoicePdfOption[] {
  const candidates = reimbursementCaseDocuments(item, itemsById);
  const expenseCandidates = candidates.filter(isExpenseDocument);
  const sources = expenseCandidates.length ? expenseCandidates : candidates.filter(entry => entry.DriveFileId);
  const options: ReimbursementInvoicePdfOption[] = [];

  for (const source of sources) {
    const pdfIndexes = reimbursementPdfAttachmentIndexes(source);
    if (!pdfIndexes.length) continue;
    if (source.DriveFileId) {
      options.push({
        ItemId: source.Id,
        AttachmentIndex: pdfIndexes[0],
        FileName: source.Attachments[pdfIndexes[0]].FileName,
        Source: "drive",
        Url: reimbursementInvoiceUrl(source) ?? undefined
      });
      continue;
    }
    if (!source.WorkerManaged) continue;
    for (const attachmentIndex of pdfIndexes) {
      options.push({
        ItemId: source.Id,
        AttachmentIndex: attachmentIndex,
        FileName: source.Attachments[attachmentIndex].FileName,
        Source: "worker"
      });
    }
  }
  return options;
}

/** Find an already archived PDF that belongs to the expense represented by a case. */
export function reimbursementInvoiceDocument(item: ReconciliationCase,
  itemsById: ReadonlyMap<string, ReimbursementItem>): ReimbursementItem | null {
  const option = reimbursementInvoicePdfOptions(item, itemsById).find(entry => entry.Source === "drive");
  return option ? itemsById.get(option.ItemId) ?? null : null;
}

export function reimbursementInvoiceUrl(item: ReimbursementItem | null | undefined): string | null {
  return item?.DriveFileId ? `https://drive.google.com/file/d/${encodeURIComponent(item.DriveFileId)}/view` : null;
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
  return Math.round(amounts.reduce<number>((sum, amount) => sum + (amount ?? 0), 0) * 100) / 100;
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

