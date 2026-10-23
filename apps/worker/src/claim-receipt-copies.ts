import type { ClaimPreparation } from "./claim-preparation.js";

/** Byte-identical copies of the same original PDF are one receipt choice.
 * Keep the source dossier unchanged for freshness checks and source provenance.
 * Different, unreadable or excessive candidates remain an explicit handoff.
 */
export async function resolveClaimReceiptCopies(dossier: ClaimPreparation,
  load: (documentId: string, attachmentId: string) => Promise<{ bytes: Buffer; name: string }>): Promise<ClaimPreparation> {
  if (dossier.blocked || dossier.attachments.length < 2 || dossier.attachments.length > 5) return dossier;
  try {
    let original: Buffer | undefined;
    for (const candidate of dossier.attachments) {
      const file = await load(candidate.documentId, candidate.attachmentId);
      if (file.name !== candidate.name || !file.bytes.length || file.bytes.length > 20_000_000
        || file.bytes.subarray(0, 5).toString('ascii') !== '%PDF-') return dossier;
      if (original && !original.equals(file.bytes)) return dossier;
      original = file.bytes;
    }
    const selected = dossier.attachments.find(a => a.documentId === dossier.expenseId) || dossier.attachments[0];
    return { ...dossier, attachments: [selected] };
  } catch { return dossier; }
}
