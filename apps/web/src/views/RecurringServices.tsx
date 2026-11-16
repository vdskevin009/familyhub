import type { SavingsContract } from "../savings";
import type { ContractPayments } from "../savings-payments";
import { ChevronRight } from "lucide-react";
import { recurringAmount } from "../recurring-presentation";
const money = (n: number, currency: string) => new Intl.NumberFormat("fr-CA", { style: "currency", currency }).format(n/100);

export default function RecurringServices({ contracts, summaries, onOpen }: {
  contracts: SavingsContract[]; summaries: ContractPayments[]; onOpen: (c: SavingsContract) => void;
}) {
  return <section className="recurring-contracts" aria-label="Services et dépenses récurrentes">
    {contracts.map(contract => {
      const amount=recurringAmount(contract,summaries.find(s=>s.contractId===contract.id));
      const date=amount.date ? new Date(amount.date+"T12:00:00Z").toLocaleDateString("fr-CA",{day:"numeric",month:"short",timeZone:"UTC"}) : null;
      return <button type="button" key={contract.id} className="recurring-package" data-recurring-contract={contract.id} onClick={()=>onOpen(contract)} aria-label={`Ouvrir le contrat ${contract.name}`}>
        <span className="recurring-monogram" aria-hidden="true">{contract.name.slice(0,1).toLocaleUpperCase("fr") || "·"}</span>
        <span className="recurring-row-copy"><strong>{contract.name}</strong><small>{amount.basis==="paid" ? `Payé${date ? ` · ${date}` : " sur la période"}` : amount.basis==="reference" ? "Référence /mois" : "Montant à confirmer"}</small></span>
        <span className={`recurring-row-amount ${amount.basis!=="paid"?"reference":""}`}><strong>{amount.cents===null ? "—" : money(amount.cents,amount.currency)}</strong><small>{amount.currency}</small></span><ChevronRight size={16} aria-hidden="true"/>
      </button>;
    })}
    <p className="recurring-amount-note">Références et montants inconnus ne sont pas ajoutés au payé.</p>
  </section>;
}
