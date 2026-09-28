import type { ReconciliationCase } from "./reconciliation.js";

export type ReimbursementWorkflowStatus = "open" | "closed" | "ignore";
export type ReimbursementWorkflowOrigin = "automatic" | "manual";

export type ReimbursementWorkflowHistoryEntry = {
  Status: ReimbursementWorkflowStatus;
  Origin: ReimbursementWorkflowOrigin;
  At: string;
  Reason?: "automatic-rule" | "manual-override" | "reset-to-automatic" | "legacy-ignore";
};

export type ReimbursementWorkflowRecord = {
  ExpenseDocumentId: string;
  ManualStatus?: ReimbursementWorkflowStatus;
  AutomaticStatus: Exclude<ReimbursementWorkflowStatus, "ignore">;
  ChangedAt: string;
  History: ReimbursementWorkflowHistoryEntry[];
};

// This list checks whether both adjudications exist; its order never defines Primary/Secondary.
const expectedInsurers = (member: ReconciliationCase["Member"]): Array<"desjardins" | "blue-cross"> =>
  member === "unknown" ? [] : ["desjardins", "blue-cross"];

function trustedAssignment(item: ReconciliationCase, insurer: "desjardins" | "blue-cross"): boolean {
  return (item.MatchAssignments ?? []).some(match =>
    match.Insurer === insurer && (match.Verification === "auto" || match.Verification === "confirmed-manually"));
}

/**
 * Primary workflow automation is deliberately conservative. A case closes automatically only
 * when the existing reconciliation already proves that no reimbursement action remains:
 * - the case is fully reimbursed/complete; or
 * - both configured Combined Benefits insurers have trusted/confirmed assignments.
 *
 * A positive remaining balance does not reopen a case after both insurer adjudications are known.
 */
export function automaticWorkflowStatus(item: ReconciliationCase): Exclude<ReimbursementWorkflowStatus, "ignore"> {
  if (item.Status === "fully-reimbursed" || item.Action === "complete") return "closed";
  const insurers = expectedInsurers(item.Member);
  if (insurers.length === 2 && insurers.every(insurer => trustedAssignment(item, insurer))) return "closed";
  return "open";
}
