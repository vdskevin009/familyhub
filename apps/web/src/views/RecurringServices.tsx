import type { SavingsContract } from "../savings";
import type { ContractPayments } from "../savings-payments";
import { ChevronRight } from "lucide-react";
const money = (n: number, currency: string) => new Intl.NumberFormat("fr-CA", { style: "currency", currency }).format(n);

export default function RecurringServices({ contracts, summaries, onOpen }: {
    contracts: SavingsContract[];
    summaries: ContractPayments[];
    onOpen: (c: SavingsContract) => void;
}) {
    return <section className="surface view-stack" aria-label="Services et dépenses récurrentes">
        <h2>Services et dépenses récurrentes</h2>
        <p>Un total par contrat. Les paiements suivent la période sélectionnée; les références mensuelles et derniers débits gardent leur propre date.</p>
        <div className="recurring-packages">{contracts.map(c => {
            const summary = summaries.find(s => s.contractId === c.id), unit = c.billing?.currency ?? "CAD";
            const services = c.services ?? [], principal = services.filter(s => s.pricing !== "included");
            const main = principal.length === 1 ? principal[0] : null;
            const children = services.filter(s => s.id !== main?.id);
            const bundled = children.length > 0;
            const amount = summary?.cents != null ? money(summary.cents / 100, unit)
                : summary?.referenceMonthly != null ? money(summary.referenceMonthly, unit)
                : summary?.latest ? money(summary.latest.outflowCents / 100, summary.latest.currency) : "À compléter";
            const basis = summary?.cents != null ? "Payé sur la période · TTC"
                : summary?.referenceMonthly != null ? "Référence TTC /mois"
                : summary?.latest ? "Dernier débit du " + summary.latest.date + " · hors période" : "Aucun montant TTC confirmé";
            return <button className="recurring-package" key={c.id} onClick={() => onOpen(c)}>
                <span className="recurring-package-heading">
                    <strong data-service-id={main?.id ?? (!services.length ? c.id : undefined)}>{main?.name ?? c.name}</strong>
                    <strong className="recurring-package-price">{amount}</strong>
                </span>
                <small className="recurring-package-basis">{bundled ? "Total du forfait · " : ""}{basis}</small>
                <small className="recurring-package-provider">{c.provider || "Fournisseur à compléter"}</small>
                {children.length > 0 && <span className="recurring-package-services">{children.map(s =>
                    <span className="recurring-package-service" data-service-id={s.id} key={s.id}>
                        <span>{s.name}</span><span className={s.pricing === "included" ? "recurring-included" : "muted"}>{s.pricing === "included" ? "Inclus" : "Coût partagé"}</span>
                    </span>
                )}</span>}
                <span className="recurring-package-link">Contrat et sources <ChevronRight size={15} aria-hidden="true" /></span>
                <span className="sr-only">Ouvrir le contrat {c.name}</span>
            </button>;
        })}</div>
        <p className="muted">Les services décrivent les contrats actuels. Aucun prix individuel n'est attribué aux services inclus ou partagés. Les références et derniers débits hors période ne s'ajoutent pas au total payé.</p>
    </section>;
}
