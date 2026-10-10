import type { SavingsContract } from "../savings";
import type { ContractPayments } from "../savings-payments";
const money = (n: number, currency: string) => new Intl.NumberFormat("fr-CA", { style: "currency", currency }).format(n);
export default function RecurringServices({ contracts, summaries, onOpen }: { contracts: SavingsContract[]; summaries: ContractPayments[]; onOpen: (c: SavingsContract) => void }) {
    return <section className="surface view-stack" aria-label="Services et dépenses récurrentes">
        <h2>Services et dépenses récurrentes</h2>
        <p>Les paiements affichés sont les montants bancaires complets de la période, taxes et frais compris sans ventilation estimée. Les services décrivent les contrats actuels.</p>
        <div className="finance-register">{contracts.flatMap(c => {
            const summary = summaries.find(s => s.contractId === c.id), unit = c.billing?.currency ?? "CAD";
            const services = c.services?.length ? c.services : [{ id: c.id, name: c.name, pricing: "documented" as const }];
            return services.map(s => {
                const bundled = services.length > 1;
                const value = s.pricing === "included" ? "Inclus" : s.pricing === "shared" || bundled ? "Coût partagé" : summary?.cents != null ? money(summary.cents / 100, unit) : "Paiement à rapprocher";
                return <button className="finance-service" key={c.id + ":" + s.id} onClick={() => onOpen(c)}><span><strong>{s.name}</strong><small>{c.name} · {c.provider || "Fournisseur à compléter"}</small></span><span><strong>{value}</strong><small>{bundled || s.pricing !== "documented" ? "Voir le total du contrat" : summary?.cents != null ? "Payé sur la période · TTC" : summary?.referenceMonthly != null ? "Référence TTC : " + money(summary.referenceMonthly, unit) + "/mois" : "TTC non confirmé"}</small></span><span className="sr-only">Ouvrir le contrat {c.name}</span></button>;
            });
        })}</div>
        <p className="muted">Chaque contrat est compté une fois. Aucun partage du prix d’un forfait n’est inventé. Une référence de facture ou un paiement ponctuel ne prédit pas les prélèvements suivants.</p>
    </section>;
}
