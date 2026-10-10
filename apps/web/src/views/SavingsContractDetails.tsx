import { Pencil, Search, FileText } from "lucide-react";
import { categories, missingInformation, type SavingsContract, type SavingsJob } from "../savings";
import type { ContractPayments } from "../savings-payments";
import { ContractPaymentDetails } from "./SavingsPayments";
const price = (value: number | null, code = "CAD") => value === null ? "À compléter" : new Intl.NumberFormat("fr-CA", { style: "currency", currency: code }).format(value);

export default function SavingsContractDetails({ contract, paid, review, onEdit, onResearch, onResults }: {
    contract: SavingsContract; paid: ContractPayments; review?: { job: SavingsJob };
    onEdit: () => void; onResearch: () => void; onResults: () => void;
}) {
    const missing = missingInformation(contract), active = review?.job.status === "queued" || review?.job.status === "running";
    return <article className="view-stack savings-contract">
        <div className="savings-contract-heading"><div><small>{categories[contract.category]}</small><strong>{contract.provider || "Fournisseur à compléter"}</strong>{contract.renewal && <small>Échéance : {contract.renewal}</small>}</div>
            <strong>{paid.cents !== null ? price(paid.cents / 100, contract.billing?.currency ?? "CAD") : paid.referenceMonthly !== null ? price(paid.referenceMonthly, contract.billing?.currency ?? "CAD") : "TTC à compléter"}<small>{paid.cents !== null ? "payé sur la période" : paid.referenceMonthly !== null ? "référence TTC /mois" : "aucun TTC confirmé"}</small></strong>
        </div>
        <p className="savings-source-price">Prix contractuel source conservé : {price(contract.price)} / {contract.cycle} · {contract.taxesIncluded === true ? "taxes incluses" : contract.taxesIncluded === false ? "avant taxes" : "taxes non confirmées"}. Ce prix historique n'est pas ajouté aux paiements.</p>
        <ContractPaymentDetails contract={contract} summary={paid} />
        {contract.promotionEnd && <p className="muted">Fin de promotion confirmée : {contract.promotionEnd.date}. Source : {contract.promotionEnd.source}</p>}
        {contract.billing && <p className="muted">Montant source : {price(contract.billing.amount, contract.billing.currency)} / {contract.billing.count} {contract.billing.unit} · {contract.billing.asOf || "date à compléter"}. {contract.billing.source}</p>}
        <details className="savings-checklist"><summary>{missing.length ? missing.length + " détails à compléter" : "Prêt pour une comparaison publique"}</summary>
            {missing.length > 0 ? <ul>{missing.map(item => <li key={item}>{item}</li>)}</ul> : <p>Les offres publiques demandent encore une vérification de l'admissibilité et des services ou garanties.</p>}
            <p className="muted">Les factures, contrats et documents restent accessibles dans la fiche de modification.</p>
        </details>
        <div className="row-actions">
            <button className="button secondary" onClick={onEdit}><Pencil size={15} />{missing.length ? "Complete details" : "Edit"}</button>
            <button className="button secondary" disabled={active} onClick={onResearch}><Search size={15} />{active ? "Researching…" : "Compare public offers"}</button>
            {review && <button className="button secondary" onClick={onResults}><FileText size={15} />{active ? "Research status" : "Results"}</button>}
        </div>
    </article>;
}
