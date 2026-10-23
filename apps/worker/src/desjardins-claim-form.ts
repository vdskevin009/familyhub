import type { ClaimPreparation } from "./claim-preparation.js";
// These two radio groups were observed in the authenticated portal (PR #135).
export function desjardinsRadioField(pathname: string) {
  if (/^\/AGEA-GBIM\/Reclamation\/TypeReclamation_TypeOfClaim\.aspx$/i.test(pathname))
    return { name: "typeReclamation", kind: "claimType", label: "Type de réclamation" };
  if (/^\/AGEA-GBIM\/Reclamation\/PersonneAssuree_InsuredPerson\.aspx$/i.test(pathname))
    return { name: "personneAssuree", kind: "patient", label: "Personne assurée — nom complet à confirmer" };
  return null;
}

export function desjardinsRadioSuggestion(kind: string, dossier: ClaimPreparation, options: {value: string; label: string}[]) {
  if (dossier.blocked || dossier.insurer !== "desjardins") return null;
  if (kind === "claimType" && /^(?:Subsequent Physiotherapy Session \(\d+ minutes\)|Physiotherapy)$/i.test(dossier.fields.service || "")) {
    const found = options.filter(o => o.label.replace(/\s+/g, " ").trim() === "Quel type de réclamation voulez-vous faire?Professionnels de la santé");
    return found.length === 1 ? found[0].value : null;
  }
  return null;
}
