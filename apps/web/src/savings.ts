import { BillingCycle, type SavingsState } from "./types";
import { newContract, baselineKey, type SavingsContract } from "../../worker/src/savings-model";
export * from "../../worker/src/savings-model";

export function effectiveContracts(state: SavingsState): SavingsContract[] {
  const saved = state.Contracts ?? [];
  const adopted = new Set(saved.map(contract => contract.sourceSubscriptionId).filter(Boolean));
  const contracts = [...saved, ...state.Subscriptions.filter(sub => !sub.Cancelled && !adopted.has(sub.Id)).map(sub => ({
    ...newContract("subscription", "legacy:" + sub.Id), name: sub.Name, provider: sub.Name,
    price: sub.Price, cycle: sub.Cycle === BillingCycle.Annual ? "annual" as const : sub.Cycle === BillingCycle.Weekly ? "weekly" as const : "monthly" as const,
    renewal: sub.Renewal.slice(0, 10), sourceSubscriptionId: sub.Id
  }))];
  if (state.Mortgage.Balance > 0 && !contracts.some(contract => contract.id === "legacy:mortgage")) contracts.push({
    ...newContract("mortgage", "legacy:mortgage"), name: "Mortgage", mortgageBalance: state.Mortgage.Balance,
    mortgageRate: state.Mortgage.BaseRate, amortizationYears: state.Mortgage.Years, termMonths: state.Mortgage.TermMonths,
    renewal: state.Mortgage.Renewal.slice(0, 10)
  });
  return contracts;
}
export async function comparisonFingerprint(contract: SavingsContract): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(baselineKey(contract)));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
