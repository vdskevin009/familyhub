// These two radio groups were observed in the authenticated portal (PR #135).
export function desjardinsRadioField(pathname: string) {
  if (/^\/AGEA-GBIM\/Reclamation\/TypeReclamation_TypeOfClaim\.aspx$/i.test(pathname))
    return { name: "typeReclamation", kind: "claimType", label: "Type de réclamation" };
  if (/^\/AGEA-GBIM\/Reclamation\/PersonneAssuree_InsuredPerson\.aspx$/i.test(pathname))
    return { name: "personneAssuree", kind: "patient", label: "Personne assurée — nom complet à confirmer" };
  return null;
}
