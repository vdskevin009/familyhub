import type { SavingsContract, SavingsCategory } from "./savings";
import type { ContractPayments } from "./savings-payments";

export const recurringCategories: Record<SavingsCategory, string> = {
  subscription: "Abonnements", telecom: "Téléphone et Internet", "credit-card": "Cartes et frais",
  "car-insurance": "Assurance auto", "home-insurance": "Assurance habitation", mortgage: "Hypothèque", other: "Autres contrats",
};

/** Presentation of the existing reconciliation only; never infer a current payment. */
export function recurringAmount(contract: SavingsContract, summary?: ContractPayments) {
  const currency = contract.billing?.currency ?? "CAD";
  if (summary?.cents != null) return { basis: "paid" as const, cents: summary.cents, currency, date: summary.rows[0]?.date ?? null };
  if (summary?.referenceMonthly != null) return { basis: "reference" as const, cents: Math.round(summary.referenceMonthly * 100), currency, date: null };
  return { basis: "unknown" as const, cents: null, currency, date: null };
}

/** Filtered, currency-separated paid totals. Unknown contracts do not manufacture zero. */
export function recurringPaidTotals(contracts: SavingsContract[], summaries: ContractPayments[]) {
  const totals: Record<string, { cents: number | null; matched: number; missing: number }> = {};
  for (const contract of contracts) {
    const amount = recurringAmount(contract, summaries.find(s => s.contractId === contract.id));
    const total = totals[amount.currency] ??= { cents: null, matched: 0, missing: 0 };
    if (amount.basis === "paid") { total.cents = (total.cents ?? 0) + amount.cents!; total.matched++; }
    else total.missing++;
  }
  return totals;
}
