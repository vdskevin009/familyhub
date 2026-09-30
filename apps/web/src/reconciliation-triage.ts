import type { ReconciliationCase, ReimbursementItem } from "./types";

export type ReconciliationCandidateStrength = "strong" | "possible";
export type ReconciliationQueueKind = "strong" | "ambiguous" | "possible" | "none";

export type ReconciliationCandidate = {
  Case: ReconciliationCase;
  ExpenseDocumentId: string;
  Score: number;
  Strength: ReconciliationCandidateStrength;
  Reasons: string[];
  DateDistanceDays: number | null;
};

export type ReconciliationTriageAssessment = {
  Kind: ReconciliationQueueKind;
  Candidates: ReconciliationCandidate[];
};

function textKey(value: string | null | undefined): string {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function meaningfulTokens(value: string | null | undefined): string[] {
  return textKey(value).split(" ").filter(token => token.length >= 3 && !["the", "and", "clinic", "health", "care"].includes(token));
}

function textCompatible(left: string | null | undefined, right: string | null | undefined): boolean {
  const a = textKey(left);
  const b = textKey(right);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const aTokens = new Set(meaningfulTokens(a));
  const bTokens = meaningfulTokens(b);
  return bTokens.some(token => aTokens.has(token));
}

function calendarDay(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86_400_000;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()) / 86_400_000;
}

export function reconciliationDateDistanceDays(left: string | null | undefined, right: string | null | undefined): number | null {
  const a = calendarDay(left);
  const b = calendarDay(right);
  return a == null || b == null ? null : Math.abs(a - b);
}

function expenseDocument(item: ReconciliationCase, itemsById: ReadonlyMap<string, ReimbursementItem>): ReimbursementItem | undefined {
  const ids = [
    ...(item.ExpenseDocumentId ? [item.ExpenseDocumentId] : []),
    ...(item.ExpenseDocumentIds ?? []),
    ...item.DocumentIds
  ];
  const seen = new Set<string>();
  const sources = ids.filter(id => !seen.has(id) && seen.add(id)).map(id => itemsById.get(id)).filter(Boolean) as ReimbursementItem[];
  return sources.find(source => source.DocumentRole === "expense")
    ?? sources.find(source => ["invoice", "receipt", "bill"].includes(source.DocumentType || ""))
    ?? sources[0];
}

export function reconciliationCaseDate(item: ReconciliationCase, itemsById: ReadonlyMap<string, ReimbursementItem>): string | null {
  return item.ServiceDate || expenseDocument(item, itemsById)?.ServiceDate || null;
}

export function reconciliationCaseExpenseId(item: ReconciliationCase): string {
  return item.ExpenseDocumentId || item.ExpenseDocumentIds?.[0] || item.DocumentIds[0] || "";
}

/** Only current worker expense cases are writable; display/history rows remain evidence. */
export function manualMatchExpenseId(item: ReconciliationCase): string | null {
  if (item.InferredFromInsurer || item.Unreconciled || item.PreviouslyFound || item.WorkflowStatus === "ignore") return null;
  return item.ExpenseDocumentId || item.ExpenseDocumentIds?.[0] || null;
}

export function manualMatchUnavailableReason(reimbursement: ReimbursementItem, item: ReconciliationCase): string | null {
  if (!manualMatchExpenseId(item)) return "This row is evidence only. Select a current expense.";
  if (!reimbursement.Member || reimbursement.Member === "unknown" || item.Member === "unknown" || reimbursement.Member !== item.Member)
    return "Matching requires the same confirmed family member.";
  if (!reimbursement.ServiceDate || !item.ServiceDate || reimbursement.ServiceDate.slice(0, 10) !== item.ServiceDate.slice(0, 10))
    return "Matching requires the same service date. Nearby invoices are shown for reference.";
  return null;
}

function scoreCandidate(reimbursement: ReimbursementItem, item: ReconciliationCase,
  itemsById: ReadonlyMap<string, ReimbursementItem>): ReconciliationCandidate | null {
  const expenseId = manualMatchExpenseId(item);
  if (!expenseId) return null;

  const source = expenseDocument(item, itemsById);
  const reimbursementMember = reimbursement.Member && reimbursement.Member !== "unknown" ? reimbursement.Member : null;
  const expenseMember = item.Member !== "unknown" ? item.Member : source?.Member && source.Member !== "unknown" ? source.Member : null;
  if (reimbursementMember && expenseMember && reimbursementMember !== expenseMember) return null;

  let score = 0;
  const reasons: string[] = [];

  if (reimbursementMember && expenseMember === reimbursementMember) {
    score += 36;
    reasons.push("Same family member");
  }

  const reimbursementDate = reimbursement.ServiceDate || null;
  const expenseDate = reconciliationCaseDate(item, itemsById);
  const dateDistance = reconciliationDateDistanceDays(reimbursementDate, expenseDate);
  if (dateDistance === 0) {
    score += 34;
    reasons.push("Exact service date");
  } else if (dateDistance != null && dateDistance <= 3) {
    score += 24;
    reasons.push(`Service date ${dateDistance} day${dateDistance === 1 ? "" : "s"} apart`);
  } else if (dateDistance != null && dateDistance <= 7) {
    score += 16;
    reasons.push(`Service date ${dateDistance} days apart`);
  } else if (dateDistance != null && dateDistance <= 30) {
    score += 7;
    reasons.push(`Within ${dateDistance} days`);
  } else if (dateDistance != null) {
    score -= 20;
  }

  const reimbursementProvider = reimbursement.Healthcare?.Provider || reimbursement.Provider;
  const expenseProvider = source?.Healthcare?.Provider || source?.Provider || item.Provider;
  if (textCompatible(reimbursementProvider, expenseProvider)) {
    score += 14;
    reasons.push("Same provider");
  }

  const reimbursementService = reimbursement.Healthcare?.ServiceType || reimbursement.ClaimedService;
  const expenseService = source?.Healthcare?.ServiceType || source?.ClaimedService || item.ServiceType;
  if (textCompatible(reimbursementService, expenseService)) {
    score += 16;
    reasons.push("Compatible service");
  }

  const reimbursementReference = reimbursement.Healthcare?.InvoiceNumber;
  const expenseReference = source?.Healthcare?.InvoiceNumber;
  if (reimbursementReference && expenseReference && textKey(reimbursementReference) === textKey(expenseReference)) {
    score += 40;
    reasons.push("Same invoice / claim reference");
  }

  const submitted = reimbursement.BilledAmount;
  const original = item.OriginalAmount ?? source?.BilledAmount ?? source?.DetectedAmount ?? null;
  if (submitted != null && original != null && Math.abs(submitted - original) < 0.01) {
    score += 20;
    reasons.push("Submitted amount matches expense");
  }

  const paid = reimbursement.ReimbursedAmount ?? reimbursement.DetectedAmount;
  if (paid != null && original != null) {
    if (paid <= original + 0.01) score += 3;
    else score -= 25;
  }

  if (reimbursement.Currency && item.Currency && reimbursement.Currency !== item.Currency) score -= 12;

  const hasStrongAnchor = reasons.some(reason => reason === "Exact service date"
    || reason === "Same invoice / claim reference"
    || reason === "Submitted amount matches expense"
    || reason === "Same provider"
    || reason === "Compatible service");
  if (score < 30 || reasons.length < 2 || (!hasStrongAnchor && reimbursementMember)) return null;

  return {
    Case: item,
    ExpenseDocumentId: expenseId,
    Score: score,
    Strength: score >= 78 ? "strong" : "possible",
    Reasons: reasons,
    DateDistanceDays: dateDistance
  };
}

/**
 * Rank candidates for human triage only. This deliberately does not mutate or auto-match.
 * The numeric score stays internal so it is not confused with the worker's match-confidence model.
 */
export function reconciliationTriageAssessment(reimbursement: ReimbursementItem, cases: ReconciliationCase[],
  itemsById: ReadonlyMap<string, ReimbursementItem>, limit = 5): ReconciliationTriageAssessment {
  const ranked = cases
    .map(item => scoreCandidate(reimbursement, item, itemsById))
    .filter((item): item is ReconciliationCandidate => Boolean(item))
    .sort((a, b) => b.Score - a.Score
      || (a.DateDistanceDays ?? Number.MAX_SAFE_INTEGER) - (b.DateDistanceDays ?? Number.MAX_SAFE_INTEGER)
      || a.Case.Id.localeCompare(b.Case.Id));

  const candidates = ranked.slice(0, Math.max(1, limit));
  if (!candidates.length) return { Kind: "none", Candidates: [] };

  const top = candidates[0];
  const second = candidates[1];
  if (top.Score >= 78 && (!second || top.Score - second.Score >= 15)) {
    return { Kind: "strong", Candidates: candidates.map((candidate, index) => ({ ...candidate, Strength: index === 0 ? "strong" : "possible" })) };
  }
  if (second && second.Score >= 50 && top.Score - second.Score <= 12) return { Kind: "ambiguous", Candidates: candidates };
  return { Kind: "possible", Candidates: candidates };
}

export function reconciliationContextCases(reimbursement: ReimbursementItem, cases: ReconciliationCase[],
  itemsById: ReadonlyMap<string, ReimbursementItem>, windowDays = 30): ReconciliationCase[] {
  const member = reimbursement.Member && reimbursement.Member !== "unknown" ? reimbursement.Member : null;
  const serviceDate = reimbursement.ServiceDate || null;
  return cases
    .filter(item => item.WorkflowStatus !== "ignore")
    .filter(item => !member || item.Member === "unknown" || item.Member === member)
    .map(item => ({ item, distance: reconciliationDateDistanceDays(serviceDate, reconciliationCaseDate(item, itemsById)) }))
    .filter(entry => serviceDate == null || entry.distance == null || entry.distance <= windowDays)
    .sort((a, b) => (a.distance ?? Number.MAX_SAFE_INTEGER) - (b.distance ?? Number.MAX_SAFE_INTEGER)
      || a.item.Id.localeCompare(b.item.Id))
    .map(entry => entry.item);
}
