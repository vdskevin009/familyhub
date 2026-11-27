import { Pencil, Search, FileText } from "lucide-react";
import { missingInformation, type SavingsContract, type SavingsJob } from "../savings";
import type { ContractPayments } from "../savings-payments";
import { ContractPaymentDetails } from "./SavingsPayments";
import { recurringAmount, recurringCategories as categories } from "../recurring-presentation";
import InsuranceReferenceDetails from "./InsuranceReferenceDetails";
const price = (value: number | null, code = "CAD") => value === null ? "Incomplete" : new Intl.NumberFormat("en-CA", { style: "currency", currency: code }).format(value);

export default function SavingsContractDetails({ contract, paid, review, onEdit, onResearch, onResults }: {
    contract: SavingsContract; paid: ContractPayments; review?: { job: SavingsJob };
    onEdit: () => void; onResearch: () => void; onResults: () => void;
}) {
    const missing = missingInformation(contract), active = review?.job.status === "queued" || review?.job.status === "running";
    const amount=recurringAmount(contract,paid);
    return <article className="view-stack savings-contract">
        <div className="savings-contract-heading"><div><small>{categories[contract.category]}</small><strong>{contract.provider || "Provider needed"}</strong>{contract.renewal && <small>Deadline: {contract.renewal}</small>}</div>
            <strong>{price(amount.cents===null ? null : amount.cents/100,amount.currency)}<small>{amount.basis==="paid" ? "Paid during the period · tax included" : amount.basis==="reference" ? "Monthly reference, tax included" : "Amount to confirm"} · {amount.currency}</small></strong>
        </div>
        {!!contract.services?.length && <section className="recurring-contract-services"><h3>Package</h3>{contract.services.map(service=><div key={service.id} data-service-id={service.id}><span>{service.name}</span><small>{service.pricing==="included" ? "Included" : service.pricing==="shared" ? "Shared package cost" : service.monthlyAmount===null ? "Amount to confirm" : `${price(service.monthlyAmount, contract.billing?.currency ?? "CAD")}/month · documented amount`}</small></div>)}<small>One total per contract. No individual price is assumed.</small></section>}
        <ContractPaymentDetails contract={contract} summary={paid} />
        <details className="recurring-source-details"><summary>Contract and supporting documents</summary><div className="view-stack">
        <p className="savings-source-price">Original contract price: {price(contract.price)} / {contract.cycle} · {contract.taxesIncluded === true ? "tax included" : contract.taxesIncluded === false ? "before tax" : "tax unconfirmed"}. This historical price is not added to payments.</p>
        <InsuranceReferenceDetails contract={contract} />
        {contract.promotionEnd && <p className="muted">Confirmed promotion end: {contract.promotionEnd.date}. Source: {contract.promotionEnd.source}</p>}
        {contract.billing && <p className="muted">Source amount: {price(contract.billing.amount, contract.billing.currency)} / {contract.billing.count} {contract.billing.unit} · {contract.billing.asOf || "date to confirm"}. {contract.billing.source}</p>}
        <details className="savings-checklist"><summary>{missing.length ? missing.length + " details to add" : "Ready for public comparison"}</summary>
            {missing.length > 0 ? <ul>{missing.map(item => <li key={item}>{item}</li>)}</ul> : <p>Public offers still require a check of eligibility, services and coverage.</p>}
            <p className="muted">You can find invoices, contracts and documents in the edit form.</p>
        </details>
        <button type="button" className="button secondary" onClick={onEdit}><FileText size={15}/>View supporting documents and details</button>
        </div></details>
        <div className="row-actions">
            <button className="button secondary" data-savings-edit onClick={onEdit}><Pencil size={15} />Edit</button>
            <button className="button secondary" data-savings-research disabled={active} onClick={onResearch}><Search size={15} />{active ? "Research in progress…" : "Compare public offers"}</button>
            {review && <button className="button" data-savings-results onClick={onResults}><FileText size={15} />{active ? "Research status" : "View comparison"}</button>}
        </div>
    </article>;
}
