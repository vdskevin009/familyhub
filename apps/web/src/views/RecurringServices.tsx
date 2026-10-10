import {
    contractMonthly,
    contractTaxes,
    recurringTotals,
    type SavingsContract,
} from "../savings";
const money = (n: number, currency: string) =>
    new Intl.NumberFormat("fr-CA", { style: "currency", currency }).format(n);
export default function RecurringServices({
    contracts,
    onOpen,
}: {
    contracts: SavingsContract[];
    onOpen: (c: SavingsContract) => void;
}) {
    return (
        <section
            className="surface view-stack"
            aria-label="Services et dépenses récurrentes"
        >
            <h2>Services et dépenses récurrentes</h2>
            <p>
                Le total compte chaque contrat une seule fois. Un service inclus
                n’a pas de prix individuel inventé.
            </p>
            <div className="finance-register">
                {contracts.flatMap((c) => {
                    const services = c.services?.length
                        ? c.services
                        : [
                              {
                                  id: c.id,
                                  name: c.name,
                                  pricing: "documented" as const,
                                  monthlyAmount: contractMonthly(c),
                                  taxesIncluded: contractTaxes(c),
                                  source: "",
                              },
                          ];
                    const unit = c.billing?.currency ?? "CAD";
                    return services.map((s) => (
                        <button
                            className="finance-service"
                            key={c.id + ":" + s.id}
                            onClick={() => onOpen(c)}
                        >
                            <span>
                                <strong>{s.name}</strong>
                                <small>
                                    {c.name} ·{" "}
                                    {c.provider || "Fournisseur à compléter"}
                                </small>
                            </span>
                            <span>
                                <strong>
                                    {s.pricing === "included"
                                        ? "Inclus"
                                        : s.pricing === "shared"
                                          ? "Coût partagé"
                                          : s.monthlyAmount === null
                                            ? "À compléter"
                                            : money(s.monthlyAmount, unit) +
                                              "/mois"}
                                </strong>
                                <small>
                                    {s.pricing === "documented"
                                        ? s.taxesIncluded === true
                                            ? "Taxes incluses"
                                            : s.taxesIncluded === false
                                              ? "Avant taxes"
                                              : "Taxes à confirmer"
                                        : "Voir le total du contrat"}
                                </small>
                            </span>
                            <span className="sr-only">
                                Ouvrir le contrat {c.name}
                            </span>
                        </button>
                    ));
                })}
            </div>
            <div className="finance-totals">
                {Object.entries(recurringTotals(contracts)).map(([code, t]) => (
                    <div key={code}>
                        <small>Équivalent mensuel connu · {code}</small>
                        <strong>{money(t.amount, code)}</strong>
                        <small>
                            {t.unknown} montant(s) à compléter · taxes selon
                            chaque source
                        </small>
                    </div>
                ))}
            </div>
            <p className="muted">
                Une facture de plusieurs jours est annualisée (365,25 ÷ 12). Ce
                repère ne prédit pas les factures suivantes. Les versements
                hypothécaires incluent du capital et des intérêts non ventilés.
            </p>
        </section>
    );
}
