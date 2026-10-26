import type { ClaimPreparation } from "./claim-preparation.js";
import { desjardinsAliasFingerprint } from "./desjardins-collector.js";
import type { ReceiptPractitioner } from "./split-paid-receipt.js";
// These two radio groups were observed in the authenticated portal (PR #135).
export function desjardinsRadioField(pathname: string) {
  if (/^\/AGEA-GBIM\/Reclamation\/TypeReclamation_TypeOfClaim\.aspx$/i.test(pathname))
    return { name: "typeReclamation", kind: "claimType", label: "Type de réclamation" };
  if (/^\/AGEA-GBIM\/Reclamation\/PersonneAssuree_InsuredPerson\.aspx$/i.test(pathname))
    return { name: "personneAssuree", kind: "patient", label: "Personne assurée — nom complet à confirmer" };
  if (pathname === "/AGEA-GBIM/Reclamation/Fournisseur/ListeFournisseur_ProviderList.aspx")
    return { name: "fournisseur", kind: "practitioner", label: "Fournisseur enregistré — identité du reçu" };
  return null;
}

export function desjardinsProviderOption(dossier: ClaimPreparation, identity: ReceiptPractitioner | null | undefined, options: {value:string;label:string}[], mainText: string) {
  if (dossier.blocked || dossier.insurer !== "desjardins" || !identity || identity.practitioner !== dossier.fields.practitioner
    || !/^(?:Subsequent Physiotherapy Session \(\d+ minutes\)|Physiotherapy)$/i.test(dossier.fields.service || "")) return null;
  const normal = (s:string) => s.normalize("NFKC").replace(/\s+/g," ").trim().toLowerCase();
  const matches = options.filter(o => normal(o.label) === normal(identity.practitioner));
  const lines = mainText.split(/\r?\n/).map(normal).filter(Boolean), name = normal(identity.practitioner);
  const indices = lines.flatMap((l,i) => l === name ? [i] : []);
  return matches.length === 1 && indices.length === 1 && lines[indices[0] + 1] === "physiothérapeute" ? matches[0].value : null;
}

/** Exact confirmed full-name alias, allowing surname-first display rotation.
 * No token is dropped, added or matched by first name alone. */
export function desjardinsPatientOption(dossier: ClaimPreparation, options: {value: string; label: string}[], aliases: Readonly<Record<string,string>>) {
  if (dossier.insurer !== "desjardins" || dossier.blocked || !dossier.fields.patient) return null;
  const matches = options.filter(o => {
    const prefix = "Pour quelle personne assurée réclamez-vous?";
    if (!o.label.startsWith(prefix)) return false;
    const words = o.label.slice(prefix.length).trim().split(/\s+/);
    if (words.length < 2 || words.length > 6) return false;
    const recognized = new Set(words.map((_, i) => aliases[desjardinsAliasFingerprint([...words.slice(i), ...words.slice(0, i)].join(" "))]).filter(Boolean));
    return recognized.size === 1 && recognized.has(dossier.fields.patient!);
  });
  return matches.length === 1 ? matches[0].value : null;
}

export function desjardinsRadioSuggestion(kind: string, dossier: ClaimPreparation, options: {value: string; label: string}[]) {
  if (dossier.blocked || dossier.insurer !== "desjardins") return null;
  if (kind === "claimType" && /^(?:Subsequent Physiotherapy Session \(\d+ minutes\)|Physiotherapy)$/i.test(dossier.fields.service || "")) {
    const found = options.filter(o => o.label.replace(/\s+/g, " ").trim() === "Quel type de réclamation voulez-vous faire?Professionnels de la santé");
    return found.length === 1 ? found[0].value : null;
  }
  return null;
}
