import type { SavingsContract } from "../savings";
import type { ContractPayments } from "../savings-payments";
import { ChevronRight, CreditCard, House, Layers, Radio, ShieldCheck, Car, Landmark } from "lucide-react";
import { recurringAmount, recurringCategories } from "../recurring-presentation";
const money = (n: number, currency: string) => new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(n/100);
const categoryIcons = { subscription: Layers, telecom: Radio, "credit-card": CreditCard, "car-insurance": Car, "home-insurance": ShieldCheck, mortgage: House, other: Landmark };

export default function RecurringServices({ contracts, summaries, onOpen }: {
  contracts: SavingsContract[]; summaries: ContractPayments[]; onOpen: (c: SavingsContract) => void;
}) {
  return <section className="recurring-contracts" aria-label="Recurring services and spending">
    {contracts.map(contract => {
      const summary=summaries.find(s=>s.contractId===contract.id);
      const amount=recurringAmount(contract,summary);
      const date=amount.date ? new Date(amount.date+"T12:00:00Z").toLocaleDateString("en-CA",{day:"numeric",month:"short",timeZone:"UTC"}) : null;
      const Icon=categoryIcons[contract.category];
      const paymentLabel=amount.basis==="paid" ? (summary!.rows.length>1 ? `${summary!.rows.length} transactions · period` : `${amount.cents!<0 ? "Refunded" : "Paid"}${date ? ` · ${date}` : " during the period"}`) : amount.basis==="reference" ? "Monthly reference" : "Amount to confirm";
      return <button type="button" key={contract.id} className="recurring-package" data-recurring-contract={contract.id} onClick={()=>onOpen(contract)} aria-label={`Open contract: ${contract.name}`}>
        <span className="recurring-monogram" aria-hidden="true"><Icon size={21}/></span>
        <span className="recurring-row-copy"><strong>{contract.name}</strong><small>{contract.services && contract.services.length>1 ? `Package · ${contract.services.length} services` : recurringCategories[contract.category]}</small><small className="recurring-payment-basis">{paymentLabel}</small></span>
        <span className={`recurring-row-amount ${amount.basis!=="paid"?"reference":""}${amount.cents!==null && amount.cents<0 ? " recurring-refund" : ""}`}><strong>{amount.cents===null ? "—" : money(amount.cents,amount.currency)}</strong><small>{amount.currency}</small></span><ChevronRight size={16} aria-hidden="true"/>
      </button>;
    })}
    {contracts.some(contract=>recurringAmount(contract,summaries.find(s=>s.contractId===contract.id)).basis!=="paid") && <p className="recurring-amount-note">Reference amounts are excluded from total paid.</p>}
  </section>;
}
