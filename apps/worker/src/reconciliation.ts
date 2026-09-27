import { createHash } from "node:crypto";
import type { Correction, Invoice } from "./invoice-model.js";
import { healthcareEvidence, memberName, type EvidenceState } from "./healthcare-evidence.js";

export type ReconciliationCase = {
  Id: string;
  ExpenseDocumentId: string;
  ExpenseDocumentIds: string[];
  Member: Invoice["Member"];
  Provider: string;
  ServiceType?: string | null;
  ServiceDate: string | null;
  OriginalAmount: number | null;
  ReimbursedAmount: number;
  PrimaryInsurer: "Desjardins" | "Blue Cross" | null;
  PrimaryReimbursedAmount: number | null;
  SecondaryInsurer: "Desjardins" | "Blue Cross" | null;
  SecondaryReimbursedAmount: number | null;
  PotentialRemaining: number | null;
  Currency: string;
  NextInsurer: "Desjardins" | "Blue Cross" | null;
  Action: "review-amount" | "submit-primary" | "submit-secondary" | "verify-balance" | "complete";
  Status: "fully-reimbursed" | "waiting-primary" | "waiting-secondary" | "patient-balance" | "needs-attention";
  Summary: string;
  Confidence: number;
  DocumentIds: string[];
  UnallocatedReimbursedAmount?: number;
  Evidence?: Record<string, { value: unknown; source: string; confidence: EvidenceState | "not-found" }>;
  Explanation?: string;
  ExtractionConfidence?: number;
  MatchConfidence?: number;
  ReconciliationConfidence?: number;
  MatchAssignments?: MatchAssignment[];
  WorkflowStatus?: "open" | "closed" | "ignore";
  WorkflowOrigin?: "automatic" | "manual";
  WorkflowChangedAt?: string;
  AutomaticWorkflowStatus?: "open" | "closed";
  WorkflowHistory?: Array<{
    Status: "open" | "closed" | "ignore";
    Origin: "automatic" | "manual";
    At: string;
    Reason?: "automatic-rule" | "manual-override" | "reset-to-automatic" | "legacy-ignore";
  }>;
};

export type MatchVerification = "auto" | "review-recommended" | "confirmed-manually";
export type MatchAssignment = {
  ExpenseDocumentId: string;
  ReimbursementDocumentId: string;
  Insurer: Invoice["Insurer"];
  Confidence: number;
  Verification: MatchVerification;
  Evidence: string[];
  ConfirmedAt?: string;
};
export type MatchDecision = {
  reimbursementId: string;
  expenseId: string;
  decision: "confirmed" | "rejected";
  at: string;
  confidence?: number;
};

export type UnmatchedReimbursement = {
  DocumentId: string;
  Reason: "ambiguous-match" | "missing-insurer" | "needs-review" | "no-expense-match";
};

export type ReconciliationSnapshot = {
  cases: ReconciliationCase[];
  unmatched: UnmatchedReimbursement[];
  rejectedMatches?: Array<{ ReimbursementDocumentId: string; ExpenseDocumentId: string }>;
  diagnostics?: ReconciliationDiagnostics;
};
export type ReconciliationDiagnostics = {
  totalExpenses: number; fullyReimbursed: number; waitingPrimary: number; waitingSecondary: number; patientBalance: number; needsAttention: number;
  unmatchedInsurerRecords: number; duplicateCandidates: number; missingServiceDates: number; unknownMembers: number; patientAsProvider: number;
  amountsReconstructed: number; insurerPaymentsOverBilled: number; contradictoryEvidence: number; averageMatchConfidence: number;
};

export function buildReconciliationDiagnostics(cases: ReconciliationCase[], unmatched: UnmatchedReimbursement[], items: Invoice[] = []): ReconciliationDiagnostics {
  const health = items.filter(item => item.Category === 0 && item.Status !== 4);
  const reconstructed = cases.filter(item => Object.values(item.Evidence || {}).some(value => value.confidence === "reconstructed")).length;
  return {
    totalExpenses: cases.length, fullyReimbursed: cases.filter(x => x.Status === "fully-reimbursed").length,
    waitingPrimary: cases.filter(x => x.Status === "waiting-primary").length, waitingSecondary: cases.filter(x => x.Status === "waiting-secondary").length,
    patientBalance: cases.filter(x => x.Status === "patient-balance").length, needsAttention: cases.filter(x => x.Status === "needs-attention").length,
    unmatchedInsurerRecords: unmatched.length, duplicateCandidates: Math.max(0, health.length - cases.length),
    missingServiceDates: cases.filter(x => !x.ServiceDate).length, unknownMembers: cases.filter(x => x.Member === "unknown").length,
    patientAsProvider: cases.filter(x => isPatientName(x.Provider)).length, amountsReconstructed: reconstructed,
    insurerPaymentsOverBilled: cases.filter(x => x.OriginalAmount != null && x.ReimbursedAmount > x.OriginalAmount + .005).length,
    contradictoryEvidence: cases.filter(x => Object.values(x.Evidence || {}).some(value => value.confidence === "unknown") && x.Status === "needs-attention").length,
    averageMatchConfidence: cases.length ? Math.round(cases.reduce((sum, x) => sum + (x.MatchConfidence || 0), 0) / cases.length) : 0
  };
}

export type CleanupSuggestion = {
  Fingerprint: string;
  Sender: string;
  Subject: string;
  Seen: number;
  Confidence: number;
  Action: "review" | "ignore-in-familyhub" | "unsubscribe-with-confirmation";
  Reason: string;
};

const insurerOrder = (member: ReconciliationCase["Member"]): Array<"desjardins" | "blue-cross"> =>
  member === "Jasmine" ? ["blue-cross", "desjardins"] : member === "Kevin" ? ["desjardins", "blue-cross"] : [];
const insurerName = (value: "desjardins" | "blue-cross"): "Desjardins" | "Blue Cross" => value === "desjardins" ? "Desjardins" : "Blue Cross";
const day = (value: string | null | undefined): number => value ? Date.parse(value.slice(0, 10)) / 86_400_000 : Number.NaN;
const providerKey = (value: string): string => value.toLowerCase().replace(/desjardins|blue cross|croix bleue|insurance|assurance/g, "").replace(/[^a-z0-9]+/g, " ").trim();

export function serviceKey(value: string): string | null {
  const key = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const services: Array<[string, RegExp]> = [
    ["physio", /\bphysio\b|physiotherap/], ["massage", /massage|massotherap/], ["chiro", /chiropr/],
    ["scaling", /scaling|detartrage/], ["root-planing", /root planing|aplan[.\w ]*de racines/],
    ["recall-exam", /examen de rappel|examination and diagnosis.*previous patient/],
    ["polishing", /polishing|polissage/], ["bitewing", /bitewing|radio interproximale/],
    ["fluoride", /fluoride|fluorures/], ["social-worker", /social worker|travailleur social/],
    ["clinical-counsellor", /clinical counsellor|psychotherapist|conseiller clinique/],
    ["orthodontic", /orthodont/], ["escitalopram", /escitalopram/]
  ];
  return services.find(([, pattern]) => pattern.test(key))?.[0] ?? null;
}
const service = (item: Invoice) => serviceKey(healthcareEvidence(item).ServiceType || item.ClaimedService || item.Provider);
const submitted = (item: Invoice): number | null => healthcareEvidence(item).SubmittedAmount ?? item.BilledAmount;
const sameMoney = (left: number | null | undefined, right: number | null | undefined) => left != null && right != null && Math.abs(left - right) < .005;
const dateDistance = (left: string | null | undefined, right: string | null | undefined): number => {
  if (!left || !right) return Number.POSITIVE_INFINITY;
  const parse = (v: string) => Date.UTC(Number(v.slice(0, 4)), Number(v.slice(5, 7)) - 1, Number(v.slice(8, 10)));
  return Math.abs(parse(left.slice(0, 10)) - parse(right.slice(0, 10))) / 86_400_000;
};
const isPatientName = (value: string) => memberName(value) !== "unknown";

/** Collapse receipt/statement copies into one expense before matching insurer rows. */
type CanonicalExpense = Invoice & { RelatedDocumentIds: string[] };
function canonicalExpenses(expenses: Invoice[]): CanonicalExpense[] {
  const result: CanonicalExpense[] = [];
  for (const item of expenses) {
    const h = healthcareEvidence(item);
    const provider = h.Provider || (item.AccountLabel === "Local Desjardins import" || isPatientName(item.Provider) ? "" : item.Provider);
    const key = `${item.Member}|${h.ServiceDate || item.ServiceDate || "unknown"}|${service(item) || serviceKey(h.ServiceType || "") || "unknown"}`;
    const candidates = result.filter(candidate => {
      const c = healthcareEvidence(candidate);
      const ckey = `${candidate.Member}|${c.ServiceDate || candidate.ServiceDate || "unknown"}|${service(candidate) || serviceKey(c.ServiceType || "") || "unknown"}`;
      const providerMatch = providerKey(candidate.Provider) === providerKey(provider) && providerKey(provider).length > 2;
      const sameInvoice = Boolean(h.InvoiceNumber && c.InvoiceNumber && h.InvoiceNumber.toLowerCase() === c.InvoiceNumber.toLowerCase());
      if (candidate.Member === "unknown" || candidate.Member !== item.Member || dateDistance(c.ServiceDate, h.ServiceDate) !== 0
        || service(candidate) && service(item) && service(candidate) !== service(item)
        || c.InvoiceNumber && h.InvoiceNumber && !sameInvoice) return false;
      const reportReceiptPair = (candidate.AccountLabel === "Local Desjardins import") !== (item.AccountLabel === "Local Desjardins import");
      const residualLink = sameMoney(c.OriginalBilledAmount, h.OriginalBilledAmount) || sameMoney(candidate.BilledAmount, h.AmountNotCovered)
        || sameMoney(item.BilledAmount, c.AmountNotCovered);
      return sameInvoice && providerMatch || key === ckey && reportReceiptPair && residualLink && Boolean(service(item));
    });
    // Ties remain separate evidence, never a first-row-wins duplicate decision.
    const existing = candidates.length === 1 ? candidates[0] : undefined;
    if (!existing) { result.push({ ...item, Provider: provider, ServiceDate: h.ServiceDate || item.ServiceDate, Healthcare: h, RelatedDocumentIds: [item.Id] }); continue; }
    existing.RelatedDocumentIds.push(item.Id);
    const eh = healthcareEvidence(existing);
    const original = eh.OriginalBilledAmount ?? h.OriginalBilledAmount ??
      (existing.BilledAmount != null && existing.BilledAmount > (h.AmountNotCovered ?? 0) ? existing.BilledAmount : item.BilledAmount);
    const residual = eh.PatientBalance ?? eh.AmountNotCovered ?? h.PatientBalance ?? h.AmountNotCovered ??
      (item.BilledAmount != null && original != null && item.BilledAmount < original ? item.BilledAmount : null);
    existing.Provider ||= provider;
    existing.BilledAmount = original;
    existing.DetectedAmount = original ?? existing.DetectedAmount;
    existing.Healthcare = { ...eh, ...h, Provider: existing.Provider, OriginalBilledAmount: original, PatientBalance: residual,
      AmountNotCovered: residual, ProcessedInsurers: [...new Set([...(eh.ProcessedInsurers || []), ...(h.ProcessedInsurers || [])])] };
    existing.Notes = `${existing.Notes} Canonical case merged from related document ${item.Id}.`;
  }
  return result;
}

/** Recover omitted report-derived expenses only when explicit service/amount evidence distinguishes them. */
export function recoverMissingDesjardinsExpenses(items: Invoice[], imported: Invoice[]): Invoice[] {
  const recovered: Invoice[] = [];
  for (const statement of items.filter(item => item.AccountLabel === "Local Desjardins import" && item.DocumentRole === "insurer-statement" && !item.NeedsReview && item.Status !== 4)) {
    if (items.some(item => item.DocumentRole === "expense" && item.Fingerprint === statement.Fingerprint)) continue;
    const candidates = imported.filter(item => item.StructuredSource && !item.NeedsReview && item.Member === statement.Member
      && item.ServiceDate === statement.ServiceDate && service(item) && service(item) === service(statement)
      && sameMoney(item.BilledAmount, submitted(statement)));
    if (candidates.length !== 1) continue;
    const related = items.filter(item => item.DocumentRole === "expense" && item.Member === statement.Member
      && item.ServiceDate === statement.ServiceDate && sameMoney(item.BilledAmount, candidates[0].BilledAmount));
    if (!related.length || related.some(item => !service(item) || service(item) === service(statement))) continue;
    recovered.push({ ...statement, Id: createHash("sha256").update(`recovered-expense:${statement.Id}`).digest("hex"),
      Provider: statement.Provider.replace(/^Desjardins\s*·\s*/, ""), DocumentType: "receipt", DocumentRole: "expense", Insurer: null,
      DetectedAmount: candidates[0].BilledAmount, BilledAmount: candidates[0].BilledAmount, ReimbursedAmount: null,
      Reasons: ["Separate service recovered from matching insurer reports; this is a reported expense, not proof of payment."],
      Notes: `${statement.Notes} Separate service restored; invoice/payment evidence still required.` });
  }
  return recovered;
}

function matchScore(expense: Invoice, statement: Invoice): number {
  if (expense.Member !== "unknown" && statement.Member !== "unknown" && expense.Member !== statement.Member) return -1;
  if (!statement.Insurer) return -1;
  const amount = expense.BilledAmount ?? expense.DetectedAmount;
  const paid = statement.ReimbursedAmount;
  if (expense.Currency && statement.Currency && expense.Currency !== statement.Currency) return -1;
  const expenseService = service(expense); const statementService = service(statement);
  const expenseEvidence = healthcareEvidence(expense);
  const statementEvidence = healthcareEvidence(statement);
  const explicitSubmitted = statementEvidence.SubmittedAmount;
  const claimed = explicitSubmitted ?? statement.BilledAmount;
  const structuredClaim = Boolean(statement.StructuredSource || statement.AccountLabel === "Local Desjardins import" && claimed != null);
  const residualEvidence = expenseEvidence.PatientBalance ?? expenseEvidence.AmountNotCovered;
  if (expenseService && statementService && expenseService !== statementService) return -1;

  // A provider receipt can already contain the exact insurer adjustment. A later insurer row
  // corroborating that same member/date/service/payment is matched evidence, not a second payment.
  const embeddedPayment = statement.Insurer === "desjardins" || statement.Insurer === "blue-cross"
    ? expenseEvidence.InsurerPayments?.[statement.Insurer] ?? null : null;
  const corroboratesEmbeddedPayment = embeddedPayment != null && paid != null && sameMoney(embeddedPayment, paid)
    && expense.Member !== "unknown" && expense.Member === statement.Member
    && expense.ServiceDate != null && expense.ServiceDate === statement.ServiceDate
    && (expenseService == null || statementService == null || expenseService === statementService)
    && expense.Confidence >= 80 && statement.Confidence >= 90;
  if (corroboratesEmbeddedPayment) return 25;

  // Document-level review is separate from match identity. Review flags lower match confidence
  // below, but do not by themselves erase a singular evidence-supported association.

  if (structuredClaim) {
    if (expense.Member === "unknown" || expense.Member !== statement.Member || expense.ServiceDate !== statement.ServiceDate
      || Math.min(expense.Confidence, statement.Confidence) < 80) return -1;
    const coordinated = claimed != null && paid != null &&
      (sameMoney(amount, claimed - paid) || sameMoney(residualEvidence, claimed - paid));
    return sameMoney(amount, claimed) || coordinated ? 20 : -1;
  }
  // Only an explicitly extracted submitted amount can disqualify a partial reimbursement.
  // Generic statement BilledAmount frequently represents the paid amount, not the expense total.
  if (explicitSubmitted != null && !sameMoney(amount, explicitSubmitted)) return -1;
  if (amount != null && paid != null && paid > amount * 1.05) return -1;

  // A person's name and a nearby date alone are not a confident match.
  const expenseProvider = providerKey(expense.Provider);
  const statementText = providerKey(`${statement.Subject} ${statement.Provider}`);
  const providerMatches = expenseProvider.length > 3 && statementText.includes(expenseProvider);
  const supportedService = expenseService != null && expenseService === statementService;
  if (expense.Member === "unknown" || expense.Member !== statement.Member || !expense.ServiceDate
    || expense.ServiceDate !== statement.ServiceDate || !(supportedService || providerMatches || sameMoney(amount, statement.BilledAmount))) return -1;

  let score = 0;
  if (expense.Member === statement.Member) score += 3;
  const expenseDay = day(expense.ServiceDate);
  const statementDay = day(statement.ServiceDate);
  if (Number.isFinite(expenseDay) && Number.isFinite(statementDay)) {
    const distance = Math.abs(expenseDay - statementDay);
    if (distance === 0) score += 5;
    else if (distance <= 3) score += 4;
    else if (distance <= 14) score += 2;
  }
  if (supportedService || providerMatches) score += 4;
  if (amount != null && paid != null) score += 1;
  if (Math.min(expense.Confidence, statement.Confidence) >= 90) score += 1;
  return score;
}

function matchConfidence(score: number, expense: Invoice, statement: Invoice): number {
  let confidence = score >= 25 ? 98 : score >= 20 ? 95 : score >= 13 ? 92 : score >= 12 ? 89 : score >= 10 ? 84 : score >= 8 ? 76 : 65;
  if (expense.NeedsReview) confidence -= 4;
  if (statement.NeedsReview) confidence -= 6;
  return Math.max(50, Math.min(99, confidence));
}

function matchEvidence(expense: Invoice, statement: Invoice): string[] {
  const result: string[] = [];
  const expenseService = service(expense);
  const statementService = service(statement);
  const expenseEvidence = healthcareEvidence(expense);
  const statementEvidence = healthcareEvidence(statement);
  if (expense.Member !== "unknown" && expense.Member === statement.Member) result.push(`Member matches: ${expense.Member}`);
  if (expense.ServiceDate && expense.ServiceDate === statement.ServiceDate) result.push(`Service date matches: ${expense.ServiceDate}`);
  if (expenseService && statementService && expenseService === statementService) result.push(`Service matches: ${statementService}`);
  const embedded = statement.Insurer ? expenseEvidence.InsurerPayments?.[statement.Insurer] : null;
  if (embedded != null && statement.ReimbursedAmount != null && sameMoney(embedded, statement.ReimbursedAmount))
    result.push(`Exact insurer payment matches receipt: ${statement.ReimbursedAmount.toFixed(2)} ${statement.Currency || expense.Currency || "CAD"}`);
  const submittedAmount = statementEvidence.SubmittedAmount;
  const expenseAmount = expense.BilledAmount ?? expense.DetectedAmount;
  if (submittedAmount != null && expenseAmount != null && sameMoney(submittedAmount, expenseAmount))
    result.push(`Submitted amount matches expense: ${submittedAmount.toFixed(2)} ${statement.Currency || expense.Currency || "CAD"}`);
  if (expense.NeedsReview || statement.NeedsReview) result.push("One source document is marked for review.");
  return result.length ? result : ["FamilyHub found one supported expense candidate."];
}

const pairKey = (reimbursementId: string, expenseId: string) => `${reimbursementId}::${expenseId}`;

export function buildReconciliationSnapshot(items: Invoice[], matchDecisions: MatchDecision[] = []): ReconciliationSnapshot {
  const health = items.filter(item => item.Category === 0 && item.Status !== 4);
  const rawExpenses = health.filter(item => item.DocumentRole === "expense"
    || ((!item.DocumentRole || item.DocumentRole === "other") && ["receipt", "invoice", "bill"].includes(item.DocumentType)));
  const expenses = canonicalExpenses(rawExpenses);
  const statements = health.filter(item => item.DocumentRole === "insurer-statement" || item.DocumentType === "claim");
  const assignments = new Map<string, Invoice[]>();
  const assignmentMeta = new Map<string, MatchAssignment>();
  const unmatchedReasons = new Map<string, UnmatchedReimbursement["Reason"]>();
  const latestByPair = new Map<string, MatchDecision>();
  for (const decision of matchDecisions) latestByPair.set(pairKey(decision.reimbursementId, decision.expenseId), decision);
  const rejectedMatches = [...latestByPair.values()].filter(decision => decision.decision === "rejected")
    .map(decision => ({ ReimbursementDocumentId: decision.reimbursementId, ExpenseDocumentId: decision.expenseId }));
  const rejectedPairs = new Set(rejectedMatches.map(item => pairKey(item.ReimbursementDocumentId, item.ExpenseDocumentId)));
  const confirmedByStatement = new Map<string, MatchDecision>();
  for (const decision of matchDecisions) if (decision.decision === "confirmed") confirmedByStatement.set(decision.reimbursementId, decision);

  // Manual confirmation is authoritative for the association while source records still exist.
  for (const [statementId, decision] of confirmedByStatement) {
    const statement = statements.find(item => item.Id === statementId);
    const expense = expenses.find(item => item.Id === decision.expenseId || item.RelatedDocumentIds.includes(decision.expenseId));
    if (!statement || !expense) continue;
    assignments.set(expense.Id, [...(assignments.get(expense.Id) ?? []), statement]);
    const score = matchScore(expense, statement);
    assignmentMeta.set(statement.Id, {
      ExpenseDocumentId: expense.Id, ReimbursementDocumentId: statement.Id, Insurer: statement.Insurer,
      Confidence: decision.confidence ?? (score >= 0 ? matchConfidence(score, expense, statement) : 100),
      Verification: "confirmed-manually", Evidence: matchEvidence(expense, statement), ConfirmedAt: decision.at
    });
  }

  // First resolve available evidence; a uniquely linked primary row can then supply the gross
  // amount required to match a secondary row. Two passes make source order irrelevant.
  for (let pass = 0; pass < 2; pass++) for (const statement of statements) {
    if ([...assignments.values()].some(rows => rows.some(item => item.Id === statement.Id))) continue;
    unmatchedReasons.delete(statement.Id);
    if (!statement.Insurer) { unmatchedReasons.set(statement.Id, "missing-insurer"); continue; }
    const ranked = expenses.filter(expense => ![expense.Id, ...expense.RelatedDocumentIds]
      .some(id => rejectedPairs.has(pairKey(statement.Id, id)))).map(expense => {
      const h = healthcareEvidence(expense);
      const primary = (assignments.get(expense.Id) || []).filter(item => item.Insurer === insurerOrder(expense.Member)[0]
        && submitted(item) != null && item.ReimbursedAmount != null
        && sameMoney(h.PatientBalance ?? h.AmountNotCovered, submitted(item)! - item.ReimbursedAmount));
      const scoringExpense = expense.BilledAmount == null && primary.length === 1 ? { ...expense, BilledAmount: submitted(primary[0]) } : expense;
      return { expense, score: matchScore(scoringExpense, statement) };
    }).sort((a, b) => b.score - a.score);
    const best = ranked[0];
    const runnerUp = ranked[1];
    if (!best || best.score < 8) { unmatchedReasons.set(statement.Id, statement.NeedsReview ? "needs-review" : "no-expense-match"); continue; }
    if (runnerUp && runnerUp.score >= best.score - 1) { unmatchedReasons.set(statement.Id, "ambiguous-match"); continue; }
    assignments.set(best.expense.Id, [...(assignments.get(best.expense.Id) ?? []), statement]);
    const confidence = matchConfidence(best.score, best.expense, statement);
    assignmentMeta.set(statement.Id, {
      ExpenseDocumentId: best.expense.Id, ReimbursementDocumentId: statement.Id, Insurer: statement.Insurer,
      Confidence: confidence, Verification: confidence >= 90 ? "auto" : "review-recommended",
      Evidence: matchEvidence(best.expense, statement)
    });
    unmatchedReasons.delete(statement.Id);
  }

  // Unmatched is a projection of the final assignment graph. An assigned insurer record can
  // therefore never remain in the review queue because of a stale, independently persisted flag.
  const assignedStatementIds = new Set([...assignments.values()].flat().map(item => item.Id));
  const unmatched: UnmatchedReimbursement[] = statements
    .filter(statement => !assignedStatementIds.has(statement.Id))
    .map(statement => ({ DocumentId: statement.Id, Reason: unmatchedReasons.get(statement.Id) ?? "no-expense-match" }));

  const cases = expenses.map(expense => {
    const matched = assignments.get(expense.Id) ?? [];
    const matchAssignments = matched.map(item => assignmentMeta.get(item.Id)).filter((item): item is MatchAssignment => Boolean(item));
    const matchConfidenceValue = matchAssignments.length ? Math.min(...matchAssignments.map(item => item.Confidence)) : 0;
    const evidence = healthcareEvidence(expense);
    const residual = evidence.PatientBalance ?? evidence.AmountNotCovered ?? null;
    let original = evidence.OriginalBilledAmount ?? expense.BilledAmount ?? (residual == null ? expense.DetectedAmount : null);
    const coordinated = matched.filter(item => (item.StructuredSource || item.AccountLabel === "Local Desjardins import") && submitted(item) != null && item.ReimbursedAmount != null
      && (sameMoney(original, submitted(item)! - item.ReimbursedAmount)
        || sameMoney(residual, submitted(item)! - item.ReimbursedAmount)));
    if (coordinated.length === 1) original = submitted(coordinated[0]);
    const member = expense.Member || "unknown";
    const order = insurerOrder(member);
    const knownPayment = (insurer: string | undefined): number | null => {
      const rows = matched.filter(item => item.Insurer === insurer);
      return rows.length && rows.every(item => item.ReimbursedAmount != null)
        ? rows.reduce((sum, item) => sum + item.ReimbursedAmount!, 0) : null;
    };
    const matchedPrimary = knownPayment(order[0]);
    const matchedSecondary = knownPayment(order[1]);
    const directPrimary = order[0] ? evidence.InsurerPayments?.[order[0]] ?? null : null;
    const directSecondary = order[1] ? evidence.InsurerPayments?.[order[1]] ?? null : null;
    // A payment embedded in the provider receipt is the same insurer payment, not an extra reimbursement.
    // Prefer a matched insurer statement when one exists; otherwise use the explicit receipt adjustment.
    const primaryKnown = matched.some(item => item.Insurer === order[0]) ? matchedPrimary : directPrimary;
    const secondaryKnown = matched.some(item => item.Insurer === order[1]) ? matchedSecondary : directSecondary;
    const primaryAmount = primaryKnown ?? 0;
    const secondaryAmount = secondaryKnown ?? 0;
    const otherMatched = matched.filter(item => !order.includes(item.Insurer as "desjardins" | "blue-cross"))
      .reduce((sum, item) => sum + (item.ReimbursedAmount ?? item.DetectedAmount ?? 0), 0);
    const reimbursed = Math.round((primaryAmount + secondaryAmount + otherMatched) * 100) / 100;
    const processedInsurers = new Set(evidence.ProcessedInsurers || []);
    const paymentsAfterResidual = matched.filter(item => item.Insurer && !processedInsurers.has(item.Insurer))
      .reduce((sum, item) => sum + (item.ReimbursedAmount ?? 0), 0);
    const missingMatchedPayment = matched.some(item => item.ReimbursedAmount == null);
    const missingProcessedPayment = [...processedInsurers].some(insurer => !matched.some(item => item.Insurer === insurer)
      && evidence.InsurerPayments?.[insurer] == null);
    const remaining = missingMatchedPayment ? null : original != null && !missingProcessedPayment
      ? Math.max(0, Math.round((original - reimbursed) * 100) / 100)
      : residual != null ? Math.max(0, Math.round((residual - paymentsAfterResidual) * 100) / 100) : null;
    const seen = new Set(matched.map(item => item.Insurer).filter(Boolean));
    for (const insurer of processedInsurers) seen.add(insurer);
    let action: ReconciliationCase["Action"] = "complete";
    let status: ReconciliationCase["Status"] = "fully-reimbursed";
    let next: ReconciliationCase["NextInsurer"] = null;
    let summary = "Documents rapprochés; aucun solde potentiel détecté.";
    const pending = unmatched.some(result => {
      const statement = statements.find(item => item.Id === result.DocumentId)!;
      return statement && statement.Member === member && dateDistance(statement.ServiceDate, expense.ServiceDate) <= 3
        && (!service(statement) || !service(expense) || service(statement) === service(expense));
    });
    const explicitPrimaryProcessed = evidence.ProcessedInsurers?.includes(order[0]);
    const explicitSecondaryProcessed = evidence.ProcessedInsurers?.includes(order[1]);
    // Keep the source document review flag intact, but do not let it override a reimbursement
    // workflow that already has a strict deterministic insurer assignment. If no insurer row
    // could be confidently assigned, the document review still blocks the reimbursement case.
    const unresolvedExpenseReview = expense.NeedsReview && matched.length === 0;
    if (unresolvedExpenseReview || !order.length || pending || remaining == null || original != null && reimbursed > original + .005) {
      action = "review-amount"; status = "needs-attention";
      summary = !order.length ? `Ordre des assureurs à confirmer. Paiements trouvés : Desjardins ${matched.filter(item => item.Insurer === "desjardins").reduce((sum, item) => sum + (item.ReimbursedAmount ?? 0), 0).toFixed(2)} $; Blue Cross ${matched.filter(item => item.Insurer === "blue-cross").reduce((sum, item) => sum + (item.ReimbursedAmount ?? 0), 0).toFixed(2)} $.`
        : original != null && reimbursed > original + .005 ? "Les paiements dépassent le montant de la dépense; vérifiez les doublons ou ajustements."
        : pending ? "Un relevé associé reste non rapproché; vérifiez les doublons, ajustements ou la facture."
        : remaining == null ? "Montant de dépense ou paiement d'assureur inconnu; vérifiez les preuves avant de calculer le solde."
        : "Vérifiez la personne ou la classification avant le rapprochement.";
    }
    else if (!seen.has(order[0]) && !explicitPrimaryProcessed) { action = "submit-primary"; status = "waiting-primary"; next = insurerName(order[0]); summary = `En attente d'un relevé de ${next}.`; }
    else if (remaining! > 0 && !seen.has(order[1])) { action = "submit-secondary"; status = "waiting-secondary"; next = insurerName(order[1]); summary = `${remaining!.toFixed(2)} $ reste à vérifier auprès de ${next}; ce montant n'est pas garanti.`; }
    else if (remaining! > 0) { action = "verify-balance"; status = "patient-balance" as ReconciliationCase["Status"]; summary = `${remaining!.toFixed(2)} $ reste à charge après les relevés trouvés.`; }
    const evidenceMap: ReconciliationCase["Evidence"] = {
      OriginalAmount: { value: original, source: coordinated.length === 1 ? coordinated[0].Id : evidence.FieldSources?.OriginalBilledAmount || "unknown", confidence: coordinated.length === 1 ? "reconstructed" : evidence.FieldStates?.OriginalBilledAmount || "unknown" },
      ServiceDate: { value: expense.ServiceDate, source: evidence.FieldSources?.ServiceDate || "extraction", confidence: expense.ServiceDate ? evidence.FieldStates?.ServiceDate || "confirmed" : "unknown" },
      ServiceType: { value: evidence.ServiceType || matched.map(item => healthcareEvidence(item).ServiceType).find(Boolean) || null,
        source: evidence.FieldSources?.ServiceType || matched.find(item => healthcareEvidence(item).ServiceType)?.Id || "unknown", confidence: evidence.ServiceType || matched.some(item => healthcareEvidence(item).ServiceType) ? "confirmed" : "unknown" },
      PatientBalance: { value: residual, source: evidence.FieldSources?.PatientBalance || evidence.FieldSources?.AmountNotCovered || "unknown", confidence: evidence.FieldStates?.PatientBalance || evidence.FieldStates?.AmountNotCovered || "unknown" },
      PrimaryPaid: { value: primaryKnown,
        source: matched.find(item => item.Insurer === order[0])?.Id || (directPrimary != null ? "receipt-explicit-payment" : explicitPrimaryProcessed ? "receipt-insurer-processing" : "not found"),
        confidence: primaryKnown != null ? "confirmed" : matched.some(item => item.Insurer === order[0]) ? "unknown" : explicitPrimaryProcessed ? "inferred" : "not-found" },
      SecondaryPaid: { value: secondaryKnown,
        source: matched.find(item => item.Insurer === order[1])?.Id || (directSecondary != null ? "receipt-explicit-payment" : explicitSecondaryProcessed ? "receipt-insurer-processing" : "no matching Blue Cross record"),
        confidence: secondaryKnown != null ? "confirmed" : matched.some(item => item.Insurer === order[1]) ? "unknown" : explicitSecondaryProcessed ? "inferred" : "not-found" }
    };
    return {
      Id: createHash("sha256").update(expense.Id + matched.map(item => item.Id).sort().join(":" )).digest("hex").slice(0, 24),
      ExpenseDocumentId: expense.Id,
      ExpenseDocumentIds: [...expense.RelatedDocumentIds],
      Member: member, Provider: expense.Provider, ServiceType: evidence.ServiceType || matched.map(item => healthcareEvidence(item).ServiceType).find(Boolean) || null,
      ServiceDate: expense.ServiceDate,
      OriginalAmount: original, ReimbursedAmount: reimbursed,
      PrimaryInsurer: order[0] ? insurerName(order[0]) : null,
      PrimaryReimbursedAmount: primaryKnown ?? (explicitPrimaryProcessed || matched.some(item => item.Insurer === order[0]) ? null : 0),
      SecondaryInsurer: order[1] ? insurerName(order[1]) : null,
      SecondaryReimbursedAmount: secondaryKnown ?? (explicitSecondaryProcessed || matched.some(item => item.Insurer === order[1]) ? null : 0),
      UnallocatedReimbursedAmount: order.length ? otherMatched : reimbursed,
      PotentialRemaining: remaining,
      Currency: expense.Currency || "CAD", NextInsurer: next, Action: action, Summary: summary,
      Status: status,
      Confidence: matched.length ? Math.min(expense.Confidence, ...matched.map(item => item.Confidence)) : expense.Confidence,
      DocumentIds: [...expense.RelatedDocumentIds, ...matched.map(item => item.Id)], Evidence: evidenceMap,
      Explanation: `Case ${expense.Id} uses ${[expense.Id, ...matched.map(item => item.Id)].length} linked evidence records. ${summary}`,
      ExtractionConfidence: expense.Confidence, MatchConfidence: matchConfidenceValue,
      MatchAssignments: matchAssignments,
      ReconciliationConfidence: matched.length ? Math.min(expense.Confidence, ...matched.map(item => item.Confidence)) : expense.Confidence
    };
  });
  const diagnostics = buildReconciliationDiagnostics(cases, unmatched, items);
  return {
    cases: cases.sort((a, b) => Number(a.Action === "complete") - Number(b.Action === "complete") || (b.PotentialRemaining ?? 0) - (a.PotentialRemaining ?? 0)),
    unmatched, rejectedMatches, diagnostics
  };
}

export function buildReconciliations(items: Invoice[]): ReconciliationCase[] {
  return buildReconciliationSnapshot(items).cases;
}

export function buildCleanupSuggestions(items: Invoice[], corrections: Correction[]): CleanupSuggestion[] {
  const groups = new Map<string, Invoice[]>();
  for (const item of items.filter(item => item.DocumentType === "marketing" || item.DocumentType === "ignore")) {
    const list = groups.get(item.Fingerprint) ?? []; list.push(item); groups.set(item.Fingerprint, list);
  }
  return [...groups.entries()].map(([fingerprint, matches]): CleanupSuggestion => {
    const learned = corrections.filter(item => item.fingerprint === fingerprint).reduce((sum, item) => sum + (item.confirmations ?? 1), 0);
    const seen = Math.max(matches.length, learned);
    const confidence = seen >= 3 ? 98 : seen === 2 ? 88 : 70;
    const canSuggestUnsubscribe = matches.some(item => item.HasUnsubscribe);
    const action: CleanupSuggestion["Action"] = seen >= 3 ? (canSuggestUnsubscribe ? "unsubscribe-with-confirmation" : "ignore-in-familyhub") : "review";
    return {
      Fingerprint: fingerprint, Sender: matches[0].Sender, Subject: matches[0].Subject, Seen: seen, Confidence: confidence,
      Action: action,
      Reason: seen >= 3 ? "Même décision répétée; FamilyHub peut filtrer automatiquement. Le désabonnement exige toujours votre confirmation." : "FamilyHub attend des décisions répétées avant d'agir automatiquement."
    };
  }).sort((a, b) => b.Confidence - a.Confidence);
}
