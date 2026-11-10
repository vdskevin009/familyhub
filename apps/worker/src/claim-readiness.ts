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
  const labels: Record<string, string> = { patient: "Personne", provider: "Clinique", serviceDate: "Date des soins", originalAmount: "Montant brut", service: "Soin" };
  for (const [key, label] of Object.entries(labels)) {
    const value = p.fields[key as keyof typeof p.fields];
    const valid = key === "originalAmount" ? typeof value === "number" && Number.isFinite(value) && value > 0 : key === "serviceDate" ? typeof value === "string" && /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value) && calendarDate(value.slice(0, 10)) !== null : typeof value === "string" && value.trim().length > 0 && value.trim().toLowerCase() !== "unknown";
    add(key, label, valid && !p.missing.includes(key) ? "available" : "missing", valid ? "Valeur connue dans les sources du dossier ; pas encore relue dans le portail." : "À établir à partir d’une pièce ; aucune valeur inventée.", valid ? value : null);
  }
  add("currency", "Devise", p.currency === "CAD" ? "available" : "missing", p.currency === "CAD" ? "Montants documentés en CAD." : "Devise inconnue ou différente ; aucune conversion implicite.");
  const amountBasis = p.originalAmountEvidence?.confidence;
  add("amount-basis", "Origine du montant brut", amountBasis === "confirmed" ? "available" : "unverified", amountBasis === "confirmed" ? "Brut corroboré dans les preuves du dossier ; le PDF original reste à vérifier." : amountBasis === "reconstructed" ? "Brut reconstruit à partir de montants documentés ; à confronter à la facture." : amountBasis === "inferred" ? "Brut déduit : hypothèse à vérifier dans les pièces." : "Base du brut non qualifiée dans cet aperçu ; consultez les pièces avant de le confirmer.");
  add("receipt", "Facture PDF", p.attachments.length ? "available" : "missing", p.attachments.length ? `${p.attachments.length} fichier(s) source. Le PC doit encore identifier et vérifier l’original exact.` : "Aucun PDF de facture dans les sources liées.", p.attachments.map(a => a.name).join(" · ") || null);
  add("practitioner", "Praticien", p.fields.practitioner ? "available" : "unverified", p.fields.practitioner ? "Identité source connue ; la sélection réelle et la clinique restent à vérifier." : "Le PC vérifiera la facture et les réponses déjà confirmées avant de demander une identité manquante.", p.fields.practitioner);
  const knownOrder = ["Blue Cross", "Desjardins"].includes(p.coordination?.primaryInsurer || "");
  add("order", "Ordre des assureurs", knownOrder ? "available" : "missing", knownOrder ? `Premier assureur : ${p.coordination!.primaryInsurer}. Aucun ordre modifié.` : "Ordre non établi ; le choix d’un portail ne prouve pas cet ordre.");
  if (p.coordination?.required) {
    const paid = p.fields.otherInsurancePaid;
    add("primary-payment", "Réponse du premier assureur", p.coordination.ready && paid != null && Number.isFinite(paid) && paid >= 0 ? "available" : "missing", p.coordination.ownerConfirmation ? "Montant confirmé par vous ; ce n’est pas un décompte importé." : p.coordination.ready ? "Montant connu, y compris zéro s’il est documenté." : "Paiement inconnu : il reste vide, distinct de zéro.");
    add("primary-statement", "Décompte du premier assureur", "unverified", p.coordination.importedStatementAvailable ? "Décision rapprochée présente. Le PDF officiel à joindre reste à vérifier si le portail le demande." : "Aucun décompte importé associé. Fournir la pièce officielle si le portail la demande ; une capture de l’app ne la remplace pas.");
  }
  add("local-duplicates", "Doublons dans FamilyHub", p.duplicate.status === "not-verified" ? "available" : "blocked", p.duplicate.status === "not-verified" ? "Aucun doublon local identifié ; les demandes récentes ou en attente du portail ne sont pas couvertes." : "Une décision ou une demande possible existe déjà pour cet assureur.");
  const blocking = p.conflicts.filter(c => !p.reviewableWarnings?.includes(c));
  if (blocking.length || p.blocked) add("source-conflict", "Cohérence des preuves", "blocked", "Résoudre les doublons, conflits ou décisions protégées avant de préparer.");
  if (p.reviewableWarnings?.length) add("source-review", "Lecture du PDF", "unverified", "Un avertissement de montant exige la lecture de la facture originale.");
  add("service-support", "Parcours automatique", p.insurer === "blue-cross" && !supportedHealthcareService(p.fields.service) ? "missing" : "unverified", p.insurer === "blue-cross" && !supportedHealthcareService(p.fields.service) ? "Ce soin n’a pas de parcours automatique reconnu ; une étape manuelle sera nécessaire." : "Le PC doit reconnaître les contrôles réels et relire le praticien sélectionné.");
  add("portal-history", "Historique de l’assureur", "unverified", "Demandes récentes, en attente et déjà déposées à vérifier avant toute nouvelle transmission.");
  add("portal-result", "Préparation dans le portail", "unverified", "Champs relus et téléversement confirmé restent à observer. Aucun envoi final automatique.");
  const status = checks.some(c => c.state === "blocked") ? "blocked" : checks.some(c => c.state === "missing") ? "needs-information" : "source-ready";
  return { status, checks, nextAction: status === "blocked" ? "Clarifier les preuves bloquantes" : status === "needs-information" ? "Compléter les éléments signalés" : "Préparer puis relire le résultat sur le PC", portalHistoryVerified: false, portalValuesVerified: false, uploadVerified: false, submitAllowed: false };
}
