import type { ClaimPreparation } from "./worker";

export function claimMissingAmountReason(dossier: ClaimPreparation): string | null {
  return dossier.missing.includes("originalAmount")
    ? "The original gross expense is unknown. Review the original invoice; a patient share or insurer payment alone cannot establish that amount. Unknown fields stay blank."
    : null;
}

export function claimBlockingReasons(dossier: ClaimPreparation): string[] {
  if (!dossier.blocked) return [];
  const insurer = dossier.insurer === "blue-cross" ? "Blue Cross" : "Desjardins";
  const reasons: string[] = [];
  if (dossier.duplicate.status === "recorded") reasons.push(`Processing by ${insurer} is already recorded for this expense. Check the ${insurer} claim in Claims before preparing another.`);
  if (dossier.duplicate.status === "possible") reasons.push(`A possible ${insurer} claim is recorded for this patient and service date. Check that insurer's history before preparing another.`);
  if (dossier.conflicts.some(c => !dossier.reviewableWarnings?.includes(c))) reasons.push("Conflicting source amounts or facts prevent preparation. Review the red evidence below and reconcile it with the original receipt in Claims.");
  return reasons.length ? reasons : ["The current Claims review state prevents preparation. Review this invoice in Claims first."];
}
