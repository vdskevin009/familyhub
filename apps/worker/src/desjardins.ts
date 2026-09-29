import { createHash } from "node:crypto";
import { toInvoice, type Invoice, type Mail } from "./invoice-model.js";

export type DesjardinsRow = {
  member: Invoice["Member"];
  serviceDate: string;
  service: string;
  submitted: number | null;
  paid: number | null;
  statementDate: string | null;
  identity: string;
  sourceClaimId?: string;
  needsReview: boolean;
};

export type DesjardinsCollection = {
  collectedAt: string;
  collectorVersion: number;
  pageCount: number;
  rows: DesjardinsRow[];
  warnings: string[];
  complete: boolean;
};

const cents = (amount: number | null | undefined) => amount == null ? null : Math.round(amount * 100);
const serviceKey = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("fr-CA");
const submittedInNotes = (notes: string) => {
  const match = notes.match(/\bSubmitted\s+([\d,]+\.\d{2})\b/i);
  return match ? Number(match[1].replace(/,/g, "")) : null;
};
const previousService = (item: Invoice) => item.ClaimedService
  ?? item.Provider.replace(/^Desjardins\s*[·:–-]\s*/i, "");
const claimKey = (member: Invoice["Member"], serviceDate: string | null, service: string,
  submitted: number | null, paid: number | null) => JSON.stringify([member, serviceDate, serviceKey(service), cents(submitted), cents(paid)]);
const nearKey = (member: Invoice["Member"], serviceDate: string | null, submitted: number | null,
  paid: number | null) => JSON.stringify([member, serviceDate, cents(submitted), cents(paid)]);

export function desjardinsInvoices(collection: DesjardinsCollection): Invoice[] {
  const mail: Mail = { id: "portal", threadId: "portal", internetMessageId: "", subject: "Desjardins reimbursement history",
    sender: "Desjardins", receivedAt: collection.collectedAt, text: "", labels: [], unsubscribe: false,
    bulk: false, attachments: [] };
  const base = toInvoice(mail, "", "Desjardins portal", { kind: "administrative", confidence: .99,
    transaction: false, reimbursement: "unknown", amount: null, currency: "CAD", category: "health",
    member: "unknown", documentRole: "other", insurer: "desjardins", serviceDate: null,
    billedAmount: null, reimbursedAmount: null, reason: "Read-only Desjardins portal history." }, "rules");
  return collection.rows.map(row => ({ ...base, Id: row.identity, Fingerprint: row.identity,
    DocumentType: "claim" as const, DocumentRole: "insurer-statement" as const, Insurer: "desjardins" as const,
    Member: row.member, ServiceDate: row.serviceDate, ClaimedService: row.service,
    Provider: `Desjardins · ${row.service}`, Subject: `Desjardins claim · ${row.service}`,
    BilledAmount: row.submitted, ReimbursedAmount: row.paid, DetectedAmount: row.paid,
    StatementDate: row.statementDate ?? undefined, PortalClaimId: row.sourceClaimId,
    PortalClaimStatus: row.paid == null ? "pended" as const : undefined,
    StructuredSource: "desjardins-portal" as const,
    NeedsReview: row.needsReview || row.member === "unknown" || row.paid == null,
    Notes: `Submitted ${row.submitted?.toFixed(2) ?? "unknown"}; paid ${row.paid?.toFixed(2) ?? "unknown"}; statement ${row.statementDate ?? "unknown"}.`,
    Reasons: [row.paid == null ? "The portal does not show a completed payment for this claim."
      : row.needsReview ? "The portal claim needs review before matching." : "Exact Desjardins portal claim row."],
    AmountSource: "email-text" as const,
  }));
}

/** Legacy report rows are evidence, not records to overwrite with portal metadata. */
export function planDesjardinsUpsert(existing: Invoice[], collection: DesjardinsCollection) {
  const imported = desjardinsInvoices(collection);
  const previous = existing.filter(item => item.Insurer === "desjardins" && item.DocumentRole === "insurer-statement");
  const byId = new Map(previous.map(item => [item.Id, item]));
  const incomingIds = new Set(imported.map(item => item.Id));
  const seen = new Set<string>();
  const usedLegacyIds = new Set<string>();
  const importedKeys = new Map<string, number>();
  for (const item of imported) {
    const key = claimKey(item.Member, item.ServiceDate, item.ClaimedService ?? "", item.BilledAmount, item.ReimbursedAmount);
    importedKeys.set(key, (importedKeys.get(key) || 0) + 1);
  }
  const planned: Invoice[] = [];
  let added = 0, changed = 0, unchanged = 0, ambiguous = 0, duplicates = 0;
  for (const item of imported) {
    if (seen.has(item.Id)) { duplicates++; ambiguous++; continue; }
    seen.add(item.Id);
    if (item.Member === "unknown" || item.ServiceDate == null || item.ReimbursedAmount == null) {
      ambiguous++; continue;
    }
    if ((importedKeys.get(claimKey(item.Member, item.ServiceDate, item.ClaimedService ?? "", item.BilledAmount, item.ReimbursedAmount)) || 0) > 1) {
      ambiguous++; continue;
    }
    const sameId = byId.get(item.Id);
    if (sameId) {
      if (sameId.StructuredSource !== "desjardins-portal") { ambiguous++; continue; }
      if (sameId.ReimbursedAmount === item.ReimbursedAmount && sameId.BilledAmount === item.BilledAmount
        && sameId.StatementDate === item.StatementDate && serviceKey(previousService(sameId)) === serviceKey(item.ClaimedService ?? "")) {
        unchanged++; continue;
      }
      if (sameId.CorrectedAt || sameId.IgnoredAt || serviceKey(previousService(sameId)) !== serviceKey(item.ClaimedService ?? "")
        || sameId.PortalClaimStatus !== "pended" && item.PortalClaimStatus === "pended") {
        ambiguous++; continue;
      }
      planned.push({ ...item, Status: sameId.Status, NeedsReview: sameId.LastDecisionId ? sameId.NeedsReview : item.NeedsReview,
        LastDecisionId: sameId.LastDecisionId,
        IgnoredAt: sameId.IgnoredAt, AccountEmail: sameId.AccountEmail, SourceMessageId: sameId.SourceMessageId,
        ThreadId: sameId.ThreadId, InternetMessageId: sameId.InternetMessageId });
      changed++; continue;
    }
    const exact = previous.filter(old => claimKey(old.Member, old.ServiceDate, previousService(old),
      old.BilledAmount ?? submittedInNotes(old.Notes), old.ReimbursedAmount)
      === claimKey(item.Member, item.ServiceDate, item.ClaimedService ?? "", item.BilledAmount, item.ReimbursedAmount));
    if (exact.length === 1 && !incomingIds.has(exact[0].Id) && !usedLegacyIds.has(exact[0].Id)) {
      usedLegacyIds.add(exact[0].Id); unchanged++; continue;
    }
    if (exact.length > 0) { ambiguous++; continue; }
    const near = previous.filter(old => nearKey(old.Member, old.ServiceDate,
      old.BilledAmount ?? submittedInNotes(old.Notes), old.ReimbursedAmount)
      === nearKey(item.Member, item.ServiceDate, item.BilledAmount, item.ReimbursedAmount));
    if (near.length > 0) { ambiguous++; continue; }
    planned.push(item); added++;
  }
  return { found: imported.length, new: added, changed, unchanged, ambiguous, duplicates, items: planned };
}

export function desjardinsIdentity(sourceClaimId: string | null, facts: unknown, occurrence: number): string {
  return createHash("sha256").update(sourceClaimId ? `desjardins-claim:${sourceClaimId}:line:${occurrence}`
    : `desjardins-row:${JSON.stringify(facts)}:${occurrence}`).digest("hex");
}
