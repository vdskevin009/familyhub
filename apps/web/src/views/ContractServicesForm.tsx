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
            <summary>Original invoice and included services</summary>
            <div className="view-stack">
                <p>
                    Keep the amount and period shown on the document. The contract total remains separate from its services.
                </p>
                <label>
                    Invoice taxes
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
                        <option value="null">Unconfirmed</option>
                        <option value="true">Included</option>
                        <option value="false">Before tax</option>
                    </select>
                </label>
                <div className="form-grid">
                    <label>
                        Billed amount
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
                        Currency
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
                        Number of units
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
                        Period
                        <select
                            value={billing.unit}
                            onChange={(e) =>
                                updateBilling("unit", e.target.value)
                            }
                        >
                            <option value="months">Months</option>
                            <option value="weeks">Weeks</option>
                            <option value="days">Days</option>
                            <option value="years">Years</option>
                        </select>
                    </label>
                    <label>
                        Amount as of
                        <input
                            type="date"
                            value={billing.asOf}
                            onChange={(e) =>
                                updateBilling("asOf", e.target.value)
                            }
                        />
                    </label>
                    <label>
                        Original source and period
                        <input
                            maxLength={3000}
                            value={billing.source}
                            onChange={(e) =>
                                updateBilling("source", e.target.value)
                            }
                            placeholder="Invoice, start and end dates, page"
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
                                    Service name
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
                                    Cost
                                    <select
                                        value={s.pricing}
                                        onChange={(e) =>
                                            change("pricing", e.target.value)
                                        }
                                    >
                                        <option value="shared">
                                            Shared within the package
                                        </option>
                                        <option value="included">
                                            Included in package
                                        </option>
                                        <option value="documented">
                                            Documented individual price
                                        </option>
                                    </select>
                                </label>
                                {s.pricing === "documented" && (
                                    <>
                                        <label>
                                            Documented monthly price
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
                                                    Unconfirmed
                                                </option>
                                                <option value="true">
                                                    Included
                                                </option>
                                                <option value="false">
                                                    Before tax
                                                </option>
                                            </select>
                                        </label>
                                    </>
                                )}
                                <label>
                                    Service source
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
                                Remove service
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
                    Add service
                </button>
            </div>
        </details>
    );
}
