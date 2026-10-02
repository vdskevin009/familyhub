import type { Invoice } from "./invoice-model.js";

/** Additive authority metadata. Existing IDs, facts and decision histories are never migrated away. */
export type ManualOverride = { Version: 1; Reasons: string[]; Derived?: true; WorkflowStatus?: "open" | "closed" | "ignore" };

export function manualReasons(item: Invoice): string[] {
  const reasons: string[] = [];
  if (item.ClassificationSource === "manual" || item.CorrectedAt) reasons.push("classification");
  if (item.LastDecisionId) reasons.push("decision-history");
  if (item.IgnoredAt) reasons.push("ignore");
  // Old indexes do not always carry provenance. Preserve non-default statuses conservatively.
  if (item.Status !== 0) reasons.push("legacy-status");
  if (Object.values(item.Healthcare?.FieldSources || {}).some(source => /manual|user/i.test(source))) reasons.push("corrected-evidence");
  return reasons;
}

export function hasManualAuthority(item: Invoice): boolean {
  return Boolean(item.ManualOverride?.Reasons.length || manualReasons(item).length);
}

/** A protected record is immutable to automatic jobs, including unknown extension fields. */
export function automaticReplacement(current: Invoice, incoming: Invoice): Invoice {
  if (hasManualAuthority(current)) return current;
  const next = { ...current, ...incoming, Id: current.Id, Fingerprint: current.Fingerprint,
    AccountEmail: current.AccountEmail, SourceMessageId: current.SourceMessageId,
    InternetMessageId: current.InternetMessageId, ThreadId: current.ThreadId,
    SourceIdentity: current.SourceIdentity ?? incoming.SourceIdentity,
    IngestedAt: current.IngestedAt ?? incoming.IngestedAt,
    Notes: current.Notes };
  if (JSON.stringify({ ...next, UpdatedAt: undefined }) === JSON.stringify({ ...current, UpdatedAt: undefined })) return current;
  return next;
}

export function sourceIdentity(item: Invoice): NonNullable<Invoice["SourceIdentity"]> {
  return { Source: item.StructuredSource ?? "gmail", ExternalId: item.PortalClaimId ?? item.SourceMessageId,
    RecordId: item.Id, Account: (item.AccountEmail || "").toLowerCase(), OriginalReference: item.InternetMessageId || item.SourceMessageId,
    Strength: item.PortalClaimId ? "external-id" : item.StructuredSource ? "source-facts" : "message-id" };
}
