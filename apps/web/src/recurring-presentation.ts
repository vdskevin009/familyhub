import type { SavingsContract, SavingsCategory } from "./savings";
import type { ContractPayments } from "./savings-payments";

export const recurringCategories: Record<SavingsCategory, string> = {
  subscription: "Abonnements", telecom: "Téléphone et Internet", "credit-card": "Cartes et frais",
  "car-insurance": "Assurance auto", "home-insurance": "Assurance habitation", mortgage: "Hypothèque", other: "Autres contrats",
};

/** Presentation of the existing reconciliation only; never infer a current payment. */
export function recurringAmount(contract: SavingsContract, summary?: ContractPayments) {
  const currency = contract.billing?.currency ?? "CAD";
  if (summary?.cents != null) return { basis: "paid" as const, cents: summary.cents, currency, date: summary.rows.length === 1 ? summary.rows[0].date : null };
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

/** Observed net payments only. Package components and reference prices never enter the chart. */
export function recurringPaidCategories(contracts: SavingsContract[], summaries: ContractPayments[]) {
  const currencies: Record<string, { category: SavingsCategory; cents: number; matched: number }[]> = {};
  for (const contract of contracts) {
    const amount = recurringAmount(contract, summaries.find(s => s.contractId === contract.id));
    if (amount.basis !== "paid") continue;
    const categories = currencies[amount.currency] ??= [];
    let category = categories.find(item => item.category === contract.category);
    if (!category) { category = { category: contract.category, cents: 0, matched: 0 }; categories.push(category); }
    category.cents += amount.cents!;
    category.matched++;
  }
  for (const categories of Object.values(currencies)) categories.sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents) || a.category.localeCompare(b.category));
  return currencies;
}
