import { supportedHealthcareService } from "./bluecross-claim-form.js";
import { calendarDate } from "./healthcare-evidence.js";

/** A source checklist, never proof of eligibility, portal history or upload. */
export type ClaimReadinessInput = {
  insurer: "blue-cross" | "desjardins"; blocked: boolean; currency?: string | null;
  originalAmountEvidence?: { source: string; confidence: string };
  fields: { patient: string | null; provider: string | null; practitioner: string | null; serviceDate: string | null; originalAmount: number | null; service: string | null; otherInsurancePaid?: number | null };
  missing: string[]; conflicts: string[]; reviewableWarnings?: string[];
  attachments: { documentId: string; attachmentId: string; name: string }[];
  duplicate: { status: string };
  coordination?: { required: boolean; ready: boolean; primaryInsurer: string | null; importedStatementAvailable?: boolean; ownerConfirmation?: unknown };
};
export type ClaimReadinessCheck = { id: string; label: string; state: "available" | "missing" | "blocked" | "unverified"; detail: string; value?: string | number | null };
export type ClaimReadiness = {
  status: "blocked" | "needs-information" | "source-ready";
  checks: ClaimReadinessCheck[]; nextAction: string;
  portalHistoryVerified: false; portalValuesVerified: false; uploadVerified: false; submitAllowed: false;
};

export function claimDossierReadiness(p: ClaimReadinessInput): ClaimReadiness {
  const checks: ClaimReadinessCheck[] = [];
  const add = (id: string, label: string, state: ClaimReadinessCheck["state"], detail: string, value?: string | number | null) => checks.push({ id, label, state, detail, ...(value !== undefined ? { value } : {}) });
  const labels: Record<string, string> = { patient: "Member", provider: "Clinic", serviceDate: "Service date", originalAmount: "Gross amount", service: "Service" };
  for (const [key, label] of Object.entries(labels)) {
    const value = p.fields[key as keyof typeof p.fields];
    const valid = key === "originalAmount" ? typeof value === "number" && Number.isFinite(value) && value > 0 : key === "serviceDate" ? typeof value === "string" && /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value) && calendarDate(value.slice(0, 10)) !== null : typeof value === "string" && value.trim().length > 0 && value.trim().toLowerCase() !== "unknown";
    add(key, label, valid && !p.missing.includes(key) ? "available" : "missing", valid ? "Known from the claim’s source documents. Not yet verified in the insurer portal." : "Needs confirmation from a source document. No value is assumed.", valid ? value : null);
  }
  add("currency", "Currency", p.currency === "CAD" ? "available" : "missing", p.currency === "CAD" ? "Amounts are documented in CAD." : "Currency is unknown or not CAD. No conversion was applied.");
  const amountBasis = p.originalAmountEvidence?.confidence;
  add("amount-basis", "Gross amount evidence", amountBasis === "confirmed" ? "available" : "unverified", amountBasis === "confirmed" ? "Claim evidence supports the gross amount. The original PDF still needs verification." : amountBasis === "reconstructed" ? "Gross amount reconstructed from documented amounts. Check it against the invoice." : amountBasis === "inferred" ? "Gross amount inferred. Check it against the source documents." : "Gross amount evidence is not confirmed in this preview. Check the source documents before confirming it.");
  add("receipt", "Invoice PDF", p.attachments.length ? "available" : "missing", p.attachments.length ? `${p.attachments.length} source file${p.attachments.length === 1 ? "" : "s"}. The PC still needs to identify and verify the exact original.` : "No invoice PDF in the linked sources.", p.attachments.map(a => a.name).join(" · ") || null);
  add("practitioner", "Practitioner", p.fields.practitioner ? "available" : "unverified", p.fields.practitioner ? "Source identity is known. The practitioner selected in the portal and the clinic still need verification." : "The PC will check the invoice and previously confirmed answers before asking for the practitioner’s name.", p.fields.practitioner);
  const knownOrder = ["Blue Cross", "Desjardins"].includes(p.coordination?.primaryInsurer || "");
  add("order", "Insurer order", knownOrder ? "available" : "missing", knownOrder ? `Primary insurer: ${p.coordination!.primaryInsurer}. Insurer order is unchanged.` : "Insurer order is not confirmed. Choosing a portal does not establish the order.");
  if (p.coordination?.required) {
    const paid = p.fields.otherInsurancePaid;
    add("primary-payment", "Primary insurer response", p.coordination.ready && paid != null && Number.isFinite(paid) && paid >= 0 ? "available" : "missing", p.coordination.ownerConfirmation ? "You confirmed the amount. It did not come from an imported statement." : p.coordination.ready ? "The amount is known, including zero when documented." : "The payment is unknown. It remains blank, not zero.");
    add("primary-statement", "Primary insurer statement", "unverified", p.coordination.importedStatementAvailable ? "A matched decision is available. Verify the official PDF if the portal asks for it." : "No imported statement is linked. If the portal asks for a statement, provide the official document, not an app screenshot.");
  }
  add("local-duplicates", "Duplicates in FamilyHub", p.duplicate.status === "not-verified" ? "available" : "blocked", p.duplicate.status === "not-verified" ? "No local duplicate was found. Recent or pending requests in the insurer portal were not checked." : "A decision or possible claim already exists for this insurer.");
  const blocking = p.conflicts.filter(c => !p.reviewableWarnings?.includes(c));
  if (blocking.length || p.blocked) add("source-conflict", "Evidence conflicts", "blocked", "Resolve duplicates, conflicts or protected decisions before preparing the claim.");
  if (p.reviewableWarnings?.length) add("source-review", "PDF review", "unverified", "An amount warning requires checking the original invoice.");
  add("service-support", "Automatic preparation", p.insurer === "blue-cross" && !supportedHealthcareService(p.fields.service) ? "missing" : "unverified", p.insurer === "blue-cross" && !supportedHealthcareService(p.fields.service) ? "This service does not have a recognized automatic path. A manual step is required." : "The PC must recognize the portal controls and verify the selected practitioner.");
  add("portal-history", "Insurer history", "unverified", "Check recent, pending and previously submitted claims before sending anything new.");
  add("portal-result", "Preparation in the insurer portal", "unverified", "Field verification and a successful upload still need to be confirmed. Final submission is never automatic.");
  const status = checks.some(c => c.state === "blocked") ? "blocked" : checks.some(c => c.state === "missing") ? "needs-information" : "source-ready";
  return { status, checks, nextAction: status === "blocked" ? "Resolve blocking evidence" : status === "needs-information" ? "Complete the missing information" : "Prepare and review the result on the PC", portalHistoryVerified: false, portalValuesVerified: false, uploadVerified: false, submitAllowed: false };
}
