import type { SavingsContract } from "../savings";
export default function ContractServicesForm({
    draft,
    onChange,
}: {
    draft: SavingsContract;
    onChange: (c: SavingsContract) => void;
}) {
    const billing = draft.billing ?? {
        amount: draft.category === "mortgage" ? null : draft.price,
        currency: "CAD",
        unit:
            draft.cycle === "annual"
                ? ("years" as const)
                : draft.cycle === "weekly"
                  ? ("weeks" as const)
                  : ("months" as const),
        count: 1,
        asOf: "",
        source: "",
        taxesIncluded: draft.taxesIncluded,
    };
    const updateBilling = (key: string, value: unknown) =>
        onChange({ ...draft, billing: { ...billing, [key]: value } });
    const services = draft.services ?? [];
    return (
        <details className="finance-contract-fields">
            <summary>Facture d’origine et services inclus</summary>
            <div className="view-stack">
                <p>
                    Conservez le montant et la période du document. Le total du
                    contrat reste indépendant de ses services.
                </p>
                <label>
                    Taxes de cette facture
                    <select
                        value={String(billing.taxesIncluded ?? null)}
                        onChange={(e) =>
                            updateBilling(
                                "taxesIncluded",
                                e.target.value === "null"
                                    ? null
                                    : e.target.value === "true",
                            )
                        }
                    >
                        <option value="null">À confirmer</option>
                        <option value="true">Incluses</option>
                        <option value="false">Avant taxes</option>
                    </select>
                </label>
                <div className="form-grid">
                    <label>
                        Montant facturé
                        <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={billing.amount ?? ""}
                            onChange={(e) =>
                                updateBilling(
                                    "amount",
                                    e.target.value === ""
                                        ? null
                                        : Number(e.target.value),
                                )
                            }
                        />
                    </label>
                    <label>
                        Devise
                        <input
                            maxLength={3}
                            pattern="[A-Z]{3}"
                            value={billing.currency}
                            onChange={(e) =>
                                updateBilling(
                                    "currency",
                                    e.target.value.toUpperCase(),
                                )
                            }
                        />
                    </label>
                    <label>
                        Nombre d’unités
                        <input
                            type="number"
                            min="1"
                            max="10000"
                            value={billing.count}
                            onChange={(e) =>
                                updateBilling("count", Number(e.target.value))
                            }
                        />
                    </label>
                    <label>
                        Période
                        <select
                            value={billing.unit}
                            onChange={(e) =>
                                updateBilling("unit", e.target.value)
                            }
                        >
                            <option value="months">Mois</option>
                            <option value="weeks">Semaines</option>
                            <option value="days">Jours</option>
                            <option value="years">Années</option>
                        </select>
                    </label>
                    <label>
                        Date du montant
                        <input
                            type="date"
                            value={billing.asOf}
                            onChange={(e) =>
                                updateBilling("asOf", e.target.value)
                            }
                        />
                    </label>
                    <label>
                        Source / période originale
                        <input
                            maxLength={3000}
                            value={billing.source}
                            onChange={(e) =>
                                updateBilling("source", e.target.value)
                            }
                            placeholder="Facture, dates de début et fin, page"
                        />
                    </label>
                </div>
                {services.map((s, i) => {
                    const change = (key: string, value: unknown) =>
                        onChange({
                            ...draft,
                            services: services.map((v, n) =>
                                n === i
                                    ? {
                                          ...v,
                                          [key]: value,
                                          ...(key === "pricing" &&
                                          value !== "documented"
                                              ? { monthlyAmount: null }
                                              : {}),
                                      }
                                    : v,
                            ),
                        });
                    return (
                        <fieldset key={s.id}>
                            <legend>Service {i + 1}</legend>
                            <div className="form-grid">
                                <label>
                                    Nom du service
                                    <input
                                        required
                                        value={s.name}
                                        maxLength={150}
                                        onChange={(e) =>
                                            change("name", e.target.value)
                                        }
                                    />
                                </label>
                                <label>
                                    Coût
                                    <select
                                        value={s.pricing}
                                        onChange={(e) =>
                                            change("pricing", e.target.value)
                                        }
                                    >
                                        <option value="shared">
                                            Partagé dans le forfait
                                        </option>
                                        <option value="included">
                                            Inclus dans le forfait
                                        </option>
                                        <option value="documented">
                                            Prix individuel documenté
                                        </option>
                                    </select>
                                </label>
                                {s.pricing === "documented" && (
                                    <>
                                        <label>
                                            Prix mensuel documenté
                                            <input
                                                type="number"
                                                min="0"
                                                step="0.01"
                                                value={s.monthlyAmount ?? ""}
                                                onChange={(e) =>
                                                    change(
                                                        "monthlyAmount",
                                                        e.target.value === ""
                                                            ? null
                                                            : Number(
                                                                  e.target
                                                                      .value,
                                                              ),
                                                    )
                                                }
                                            />
                                        </label>
                                        <label>
                                            Taxes
                                            <select
                                                value={String(s.taxesIncluded)}
                                                onChange={(e) =>
                                                    change(
                                                        "taxesIncluded",
                                                        e.target.value ===
                                                            "null"
                                                            ? null
                                                            : e.target.value ===
                                                                  "true",
                                                    )
                                                }
                                            >
                                                <option value="null">
                                                    À confirmer
                                                </option>
                                                <option value="true">
                                                    Incluses
                                                </option>
                                                <option value="false">
                                                    Avant taxes
                                                </option>
                                            </select>
                                        </label>
                                    </>
                                )}
                                <label>
                                    Source du service
                                    <input
                                        required={s.pricing === "documented"}
                                        maxLength={2000}
                                        value={s.source}
                                        onChange={(e) =>
                                            change("source", e.target.value)
                                        }
                                    />
                                </label>
                            </div>
                            <button
                                className="button secondary"
                                type="button"
                                onClick={() =>
                                    onChange({
                                        ...draft,
                                        services: services.filter(
                                            (_, n) => i !== n,
                                        ),
                                    })
                                }
                            >
                                Retirer ce service
                            </button>
                        </fieldset>
                    );
                })}
                <button
                    className="button secondary"
                    type="button"
                    disabled={services.length >= 30}
                    onClick={() =>
                        onChange({
                            ...draft,
                            services: [
                                ...services,
                                {
                                    id: crypto.randomUUID(),
                                    name: "",
                                    pricing: "shared",
                                    monthlyAmount: null,
                                    taxesIncluded: null,
                                    source: "",
                                },
                            ],
                        })
                    }
                >
                    Ajouter un service
                </button>
            </div>
        </details>
    );
}
