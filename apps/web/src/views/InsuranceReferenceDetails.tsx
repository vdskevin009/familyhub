import type { SavingsContract } from "../savings";
import { insuranceExport, type InsuranceReference } from "../../../worker/src/insurance-reference";
import "../insurance-reference.css";
const status = { documented: "Documenté", historical: "Historique", unknown: "À vérifier", preparing: "En préparation · non envoyé", sent: "Envoyé · devis attendu", awaiting_quote: "En attente de devis", received: "Devis reçu", expired: "Expiré" };
const certainty = { documented: "Documenté", reported: "Déclaré", unknown: "Inconnu", conflict: "À clarifier" };
const kind = { policy: "Police", "strata-certificate": "Copropriété · immeuble", membership: "Adhésion", "quote-request": "Demande de devis", quote: "Devis daté" };
const scope = { original: "Document original", capture: "Captures partielles", historical: "Preuve historique", payment: "Paiement observé", statement: "Déclaration", quote: "Devis reçu", advertisement: "Publicité" };
const verification = { "parent-verified": "Vérification rapportée", "locally-read": "Document lu ici", unverified: "À vérifier" };
function download(contract: SavingsContract) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(insuranceExport(contract), null, 2)], { type: "application/json" }));
  const a = document.createElement("a"); a.href = url; a.download = "assurances-reference-privee.json"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Proofs({ reference, ids }: { reference: InsuranceReference; ids: string[] }) {
  return <ul>{ids.map(id => { const s = reference.sources.find(s => s.id === id)!; return <li key={id}><strong>{s.title}</strong> · {s.date || "date source inconnue"} · {scope[s.scope]} · {verification[s.verification]}<br /><span className="insurance-source-reference">{s.reference}</span></li>; })}</ul>;
}
export default function InsuranceReferenceDetails({ contract }: { contract: SavingsContract }) {
  const reference = contract.insuranceReference; if (!reference) return null;
  return <section className="insurance-reference view-stack" aria-label="Référentiel assurances">
    <header><h3>Référentiel assurances</h3><p className="muted">Conservé sur le PC partagé · enregistré le {reference.updatedAt}. Les inconnus et preuves partielles restent explicites.</p><button className="button secondary" onClick={() => download(contract)}>Exporter le référentiel privé (JSON)</button></header>
    <p className="muted">L'export contient des informations privées. Il n'est pas envoyé aux assureurs ou à une recherche publique.</p>
    {reference.records.map(r => <details className="savings-checklist insurance-record" key={r.id}>
      <summary><span>{r.title}<small>{kind[r.kind]} · {status[r.status]}{reference.records.some(next => next.supersedes === r.id) ? " · version remplacée conservée" : ""}</small></span></summary>
      <p><strong>{r.provider}</strong>{r.effectiveFrom || r.effectiveTo ? ` · période ${r.effectiveFrom || "inconnue"} → ${r.effectiveTo || "inconnue"}` : " · période à vérifier"}</p>
      {r.kind === "quote-request" && <p>Aucun devis reçu ni tarif confirmé. Demande {r.requestedOn ? `datée du ${r.requestedOn}` : "non envoyée"}.</p>}
      {r.kind === "quote" && <p>Reçu le {r.receivedOn} · valable jusqu'au {r.validUntil || "date inconnue"} · prime annuelle {r.quotedAnnualPremium === null ? "inconnue" : `${r.quotedAnnualPremium} CAD`} · comparaison : {r.comparison}.</p>}
      <dl className="insurance-facts">{r.facts.map(f => <div key={f.code}><dt>{f.label}</dt><dd><strong>{f.value === null ? "Inconnu" : typeof f.value === "number" ? new Intl.NumberFormat("fr-CA", { maximumFractionDigits: 5 }).format(f.value) : typeof f.value === "boolean" ? f.value ? "Oui" : "Non" : f.value}{f.value !== null && f.unit ? ` ${f.unit}` : ""}</strong><small>{certainty[f.certainty]}</small>{f.notes && <p>{f.notes}</p>}<details><summary>Preuve et définition</summary><p>Clé : {f.code}</p><Proofs reference={reference} ids={f.sourceIds} /></details></dd></div>)}</dl>
      {!!r.assumptions.length && <><h4>Hypothèses</h4><ul>{r.assumptions.map((s, i) => <li key={i}>{s}</li>)}</ul></>}
      {!!r.differences.length && <><h4>Différences de comparaison</h4><ul>{r.differences.map((s, i) => <li key={i}>{s}</li>)}</ul></>}
      {!!r.limitations.length && <><h4>Limites et points à confirmer</h4><ul>{r.limitations.map((s, i) => <li key={i}>{s}</li>)}</ul></>}
      <details><summary>Sources du dossier</summary><Proofs reference={reference} ids={r.sourceIds} /></details>
    </details>)}
  </section>;
}
