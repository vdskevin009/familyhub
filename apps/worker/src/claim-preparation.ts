import type { Invoice } from "./invoice-model.js";
import type { ReconciliationCase } from "./reconciliation.js";
import type { Insurer } from "./healthcare-evidence.js";

export const claimPortals = {
  "blue-cross": "https://service.pac.bluecross.ca/member/",
  desjardins: "https://www.agea-gbim.dsf-dfs.com/AGEA-GBIM/Athntfctn/Authentification_Authentication.aspx?bhcp=1&cltr=fr-CA"
} as const;
const clean = (value = "") => value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
export function prepareClaim(expenseId: string, insurer: Insurer, invoices: Invoice[], cases: ReconciliationCase[]) {
  if (!(insurer in claimPortals)) throw new Error("Choose a supported insurer.");
  const expense = invoices.find(x => x.Id === expenseId);
  if (!expense || expense.Category !== 0 || expense.DocumentRole !== "expense") throw new Error("An original healthcare expense is required.");
  const entry = cases.find(x => x.DocumentIds.includes(expenseId));
  const sources = invoices.filter(x => entry?.DocumentIds.includes(x.Id) && x.DocumentRole === "expense");
  if (!sources.length) sources.push(expense);
  const member = entry?.Member ?? expense.Member;
  const date = entry?.ServiceDate ?? expense.ServiceDate;
  const service = entry?.ServiceType || expense.Healthcare?.ServiceType || expense.ClaimedService || null;
  const amount = entry?.OriginalAmount ?? expense.Healthcare?.OriginalBilledAmount ?? expense.BilledAmount;
  const ids = new Set(sources.map(x => x.Id));
  const assignedIds = new Set((entry?.MatchAssignments ?? []).map(x => x.ReimbursementDocumentId));
  const recorded = invoices.filter(x => x.Insurer === insurer && assignedIds.has(x.Id));
  const processed = sources.some(x => x.Healthcare?.ProcessedInsurers?.includes(insurer)
    || x.Healthcare?.InsurerPayments?.[insurer] != null);
  const possible = invoices.filter(x => x.DocumentRole === "insurer-statement" && x.Insurer === insurer
    && !recorded.some(r => r.Id === x.Id) && member !== "unknown" && x.Member === member
    && date && x.ServiceDate?.slice(0, 10) === date.slice(0, 10));
  const duplicateStatus = recorded.length || processed ? "recorded" : possible.length ? "possible" : "not-verified";
  const conflicts = [...new Set(sources.flatMap(x => x.Healthcare?.Conflicts ?? []))];
  // A legacy report may own the expense identity while an original receipt owns
  // its clinic, practitioner and invoice number. Never pick an unrelated source.
  const sourceField = (key: "Provider" | "Practitioner" | "InvoiceNumber" | "ServiceType") => {
    const found = sources.filter(x => x.Healthcare?.[key]);
    const values = [...new Set(found.map(x => clean(x.Healthcare![key]!)))];
    if (key === "ServiceType" && values.length > 1) {
      const longest = found.slice().sort((a, b) => b.Healthcare![key]!.length - a.Healthcare![key]!.length)[0].Healthcare![key]!;
      if (values.every(v => clean(longest) === v || clean(longest).startsWith(`${v} `))) return longest;
    }
    if (values.length > 1) { conflicts.push(`${key} differs between original expense sources.`); return null; }
    return found[0]?.Healthcare?.[key] || null;
  };
  const otherInsurer: Insurer = insurer === "blue-cross" ? "desjardins" : "blue-cross";
  const namedPayment = otherInsurer === "desjardins" ? entry?.DesjardinsReimbursedAmount : entry?.BlueCrossReimbursedAmount;
  const directPayments = [...new Set(sources.map(x => x.Healthcare?.InsurerPayments?.[otherInsurer]).filter((x): x is number => x != null))];
  const payments = [...new Set([namedPayment, ...directPayments].filter((x): x is number => x != null))];
  if (payments.length > 1) conflicts.push("Other-insurer payment differs between saved evidence.");
  const otherInsurancePaid = !entry?.HasUnresolvedReimbursementEvidence && payments.length === 1 ? payments[0] : null;
  const fields = { patient: member === "unknown" ? null : member,
    provider: sourceField("Provider") || sources.find(x => x.AccountLabel !== "Local Desjardins import" && x.Provider)?.Provider || expense.Provider || null,
    practitioner: sourceField("Practitioner"), serviceDate: date || null,
    originalAmount: amount ?? null, service: sourceField("ServiceType") || service, invoiceNumber: sourceField("InvoiceNumber"),
    otherInsurance: otherInsurancePaid != null || sources.some(x => x.Healthcare?.ProcessedInsurers?.includes(otherInsurer)) ? "Yes" : null,
    otherInsurancePaid };
  const missing = Object.entries(fields).filter(([key, value]) => ["patient", "provider", "serviceDate", "originalAmount", "service"].includes(key) && (value == null || value === "")).map(([key]) => key);
  const attachments = sources.flatMap(source => source.Attachments.filter(a => a.MimeType === "application/pdf" || /\.pdf$/i.test(a.FileName))
    .map(a => ({ documentId: source.Id, attachmentId: a.Id, name: a.FileName })));
  // A duplicated receipt extraction can mistake an insurer adjustment for the
  // gross. Keep that warning, and require explicit PDF review for preparation.
  // This does not repair source records or override other conflicting facts.
  const reviewableWarnings = conflicts.filter(c => {
    const match = /^OriginalBilledAmount differs from direct-insurance arithmetic \((\d+(?:\.\d+)?) vs (\d+(?:\.\d+)?)\)\.$/.exec(c);
    return match && Number(match[1]) === amount && otherInsurancePaid != null
      && sources.some(x => x.Healthcare?.OriginalBilledAmount === amount && x.Healthcare?.AmountNotCovered != null
        && Math.abs(amount! - otherInsurancePaid - x.Healthcare.AmountNotCovered) < .005);
  });
  const blockingConflicts = conflicts.filter(c => !reviewableWarnings.includes(c));
  return { expenseId, insurer, portalUrl: claimPortals[insurer], fields, missing, conflicts, attachments,
    otherInsurer, currency: entry?.Currency || expense.Currency || null, reviewableWarnings,
    duplicate: { status: duplicateStatus, checkedAt: new Date().toISOString(), scope: "Saved local invoice and insurer records only; current portal history has not been verified.",
      records: [...recorded, ...possible].map(x => ({ id: x.Id, reference: x.PortalClaimId || x.Healthcare?.ClaimReference || null, service: x.ClaimedService || x.Healthcare?.ServiceType || null, status: x.PortalClaimStatus || "recorded" })) },
    blocked: duplicateStatus !== "not-verified" || blockingConflicts.length > 0 || expense.IgnoredAt != null || entry?.WorkflowStatus === "ignore",
    sourceEmails: sources.filter(x => ids.has(x.Id)).map(x => ({ account: x.AccountEmail, messageId: x.SourceMessageId })),
    submitAllowed: false as const };
}
export type ClaimPreparation = ReturnType<typeof prepareClaim>;

// Map against options actually present in the chosen insurer's current form.
// Different clinical designations are never globally aliased.
export function exactServiceOption(service: string | null, options: { value: string; label: string }[]): string | null {
  if (!service) return null;
  const value = clean(service);
  const exact = options.filter(o => o.value && clean(o.label) === value);
  return exact.length === 1 ? exact[0].value : null;
}
