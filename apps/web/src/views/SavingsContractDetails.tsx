import { Pencil, Search, FileText } from "lucide-react";
import { missingInformation, type SavingsContract, type SavingsJob } from "../savings";
import type { ContractPayments } from "../savings-payments";
import { ContractPaymentDetails } from "./SavingsPayments";
import { recurringAmount, recurringCategories as categories } from "../recurring-presentation";
import InsuranceReferenceDetails from "./InsuranceReferenceDetails";
const price = (value: number | null, code = "CAD") => value === null ? "À compléter" : new Intl.NumberFormat("fr-CA", { style: "currency", currency: code }).format(value);

export default function SavingsContractDetails({ contract, paid, review, onEdit, onResearch, onResults }: {
    contract: SavingsContract; paid: ContractPayments; review?: { job: SavingsJob };
    onEdit: () => void; onResearch: () => void; onResults: () => void;
}) {
    const missing = missingInformation(contract), active = review?.job.status === "queued" || review?.job.status === "running";
    const amount=recurringAmount(contract,paid);
    return <article className="view-stack savings-contract">
        <div className="savings-contract-heading"><div><small>{categories[contract.category]}</small><strong>{contract.provider || "Fournisseur à compléter"}</strong>{contract.renewal && <small>Échéance : {contract.renewal}</small>}</div>
            <strong>{price(amount.cents===null ? null : amount.cents/100,amount.currency)}<small>{amount.basis==="paid" ? "Payé sur la période · TTC" : amount.basis==="reference" ? "Référence TTC /mois" : "Montant à confirmer"} · {amount.currency}</small></strong>
        </div>
        {!!contract.services?.length && <section className="recurring-contract-services"><h3>Forfait</h3>{contract.services.map(service=><div key={service.id} data-service-id={service.id}><span>{service.name}</span><small>{service.pricing==="included" ? "Inclus" : service.pricing==="shared" ? "Coût du forfait partagé" : service.monthlyAmount===null ? "Montant à confirmer" : `${price(service.monthlyAmount, contract.billing?.currency ?? "CAD")}/mois · montant documenté`}</small></div>)}<small>Un seul total par contrat ; aucun prix individuel supposé.</small></section>}
        <ContractPaymentDetails contract={contract} summary={paid} />
        <details className="recurring-source-details"><summary>Contrat et justificatifs</summary><div className="view-stack">
        <p className="savings-source-price">Prix contractuel source conservé : {price(contract.price)} / {contract.cycle} · {contract.taxesIncluded === true ? "taxes incluses" : contract.taxesIncluded === false ? "avant taxes" : "taxes non confirmées"}. Ce prix historique n'est pas ajouté aux paiements.</p>
        <InsuranceReferenceDetails contract={contract} />
        {contract.promotionEnd && <p className="muted">Fin de promotion confirmée : {contract.promotionEnd.date}. Source : {contract.promotionEnd.source}</p>}
        {contract.billing && <p className="muted">Montant source : {price(contract.billing.amount, contract.billing.currency)} / {contract.billing.count} {contract.billing.unit} · {contract.billing.asOf || "date à compléter"}. {contract.billing.source}</p>}
        <details className="savings-checklist"><summary>{missing.length ? missing.length + " détails à compléter" : "Prêt pour une comparaison publique"}</summary>
            {missing.length > 0 ? <ul>{missing.map(item => <li key={item}>{item}</li>)}</ul> : <p>Les offres publiques demandent encore une vérification de l'admissibilité et des services ou garanties.</p>}
            <p className="muted">Les factures, contrats et documents restent accessibles dans la fiche de modification.</p>
        </details>
        <button type="button" className="button secondary" onClick={onEdit}><FileText size={15}/>Voir les justificatifs et les détails</button>
        </div></details>
        <div className="row-actions">
            <button className="button secondary" data-savings-edit onClick={onEdit}><Pencil size={15} />Modifier</button>
            <button className="button secondary" data-savings-research disabled={active} onClick={onResearch}><Search size={15} />{active ? "Recherche en cours…" : "Comparer les offres publiques"}</button>
            {review && <button className="button" data-savings-results onClick={onResults}><FileText size={15} />{active ? "État de la recherche" : "Voir la comparaison"}</button>}
        </div>
    </article>;
}
