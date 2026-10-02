// Only the two claim radio groups observed in the authenticated portal.
// Random element IDs and full beneficiary names remain session-local; choosing a
// beneficiary requires operator review rather than a partial-name match.
export function desjardinsRadioField(pathname: string) {
 if (/^\/AGEA-GBIM\/Reclamation\/TypeReclamation_TypeOfClaim\.aspx$/i.test(pathname))
  return { name: "typeReclamation", kind: "claimType", label: "Type de réclamation" };
 if (/^\/AGEA-GBIM\/Reclamation\/PersonneAssuree_InsuredPerson\.aspx$/i.test(pathname))
  return { name: "personneAssuree", kind: "patient", label: "Personne assurée — vérifiez le nom complet" };
 return null;
}
