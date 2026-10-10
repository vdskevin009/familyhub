/** Portable, deterministic Savings model shared by the PWA and private worker. */
export const categories = {
  subscription: "Subscriptions", telecom: "Phone & internet", "credit-card": "Credit cards & fees",
  "car-insurance": "Car insurance", "home-insurance": "Home insurance", mortgage: "Mortgage", other: "Other recurring costs"
} as const;
export type SavingsCategory = keyof typeof categories;
export type ContractDocument = { id: string; name: string; type: string; size: number; addedAt: string };
export type ContractBilling = { amount: number | null; currency: string; unit: "months" | "weeks" | "days" | "years"; count: number; asOf: string; source: string; taxesIncluded?: boolean | null };
export type ContractService = { id: string; name: string; pricing: "shared" | "included" | "documented"; monthlyAmount: number | null; taxesIncluded: boolean | null; source: string };
export type SavingsContract = {
  id: string; name: string; category: SavingsCategory; provider: string; price: number | null;
  cycle: "monthly" | "annual" | "weekly"; taxesIncluded: boolean | null;
  province: string; renewal: string; commitmentEnd: string; cancellationFee: number | null;
  annualLostDiscounts: number | null; currentPromoMonths: number; priceAfterPromo: number | null;
  needs: string; discounts: string; notes: string; documents: ContractDocument[];
  liabilityLimit: number | null; collisionDeductible: number | null; comprehensiveDeductible: number | null;
  dataGb: number | null; downloadMbps: number | null; lines: number;
  mortgageBalance: number | null; mortgageRate: number | null; amortizationYears: number | null;
  termMonths: number | null; rateType: "fixed" | "variable";
  sourceSubscriptionId?: string; updatedAt: string;
  billing?: ContractBilling; services?: ContractService[];
};
export type PublicBaseline = Pick<SavingsContract, "category" | "price" | "cycle" | "taxesIncluded" | "province" |
  "cancellationFee" | "annualLostDiscounts" | "currentPromoMonths" | "priceAfterPromo" |
  "liabilityLimit" | "collisionDeductible" | "comprehensiveDeductible" | "dataGb" | "downloadMbps" | "lines" |
  "mortgageBalance" | "mortgageRate" | "amortizationYears" | "termMonths" | "rateType"> & { provider: string };
export type SavingsOffer = {
  provider: string; title: string; kind: "public-estimate"; currentProvider: boolean;
  monthlyPrice: number | null; promoMonths: number; monthlyPriceAfterPromo: number | null;
  upfrontFees: number | null; annualLostDiscounts: number | null; taxesIncluded: boolean;
  comparable: boolean; differences: string[]; conditions: string[]; checkedAt: string; validUntil: string | null;
  sources: { title: string; url: string }[];
  liabilityLimit: number | null; collisionDeductible: number | null; comprehensiveDeductible: number | null;
  mortgageRate: number | null; termMonths: number | null; amortizationYears: number | null; rateType: "fixed" | "variable";
  /** Offers sharing any affected contract cannot be added together. */
  affectedContractIds: string[];
};
export type SavingsReport = { summary: string; missing: string[]; offers: SavingsOffer[] };
export type SavingsJob = { id: string; contractId: string; baselineKey: string; baseline: PublicBaseline;
  status: "queued" | "running" | "complete" | "failed"; createdAt: string; completedAt?: string;
  report?: SavingsReport; error?: string; scheduledDate?: string };
export type SavedSavingsReview = { job: SavingsJob; decisions: Record<string, "review" | "shortlist" | "dismissed"> };

export function newContract(category: SavingsCategory = "telecom", id = ""): SavingsContract {
  return { id, category, name: "", provider: "", price: null, cycle: "monthly", taxesIncluded: null,
    province: "BC", renewal: "", commitmentEnd: "", cancellationFee: null, annualLostDiscounts: null,
    currentPromoMonths: 0, priceAfterPromo: null, needs: "", discounts: "", notes: "", documents: [],
    liabilityLimit: null, collisionDeductible: null, comprehensiveDeductible: null, dataGb: null,
    downloadMbps: null, lines: 1, mortgageBalance: null, mortgageRate: null, amortizationYears: null,
    termMonths: null, rateType: "fixed", updatedAt: "" };
}
export const publicProviders = ["ICBC", "BCAA", "Family Insurance", "TD Insurance", "RBC Insurance", "Wawanesa",
  "Intact", "Aviva", "Co-operators", "TELUS", "Rogers", "Bell", "Fido", "Koodo", "Virgin Plus", "Freedom Mobile",
  "Public Mobile", "Fizz", "Shaw", "TekSavvy", "Oxio", "Lightspeed", "Novus", "TD", "RBC", "BMO", "CIBC",
  "Scotiabank", "Tangerine", "Simplii", "Vancity", "Coast Capital", "Desjardins", "American Express",
  "Netflix", "Spotify", "Disney+", "Amazon Prime", "Apple", "Google", "Microsoft", "OpenAI", "YouTube"];
publicProviders.push("Allstate", "CAA", "Sonnet", "belairdirect", "Economical", "Definity", "Square One",
  "Beneva", "Gore Mutual", "SGI CANADA", "Manulife", "National Bank", "EQ Bank", "MBNA", "Laurentian Bank",
  "Videotron", "Eastlink", "SaskTel", "Cogeco", "Distributel", "EBOX", "Beanfield", "Tbaytel", "Chatr",
  "Lucky Mobile", "PC Mobile", "Zoomer Wireless", "Crave", "Paramount+", "Adobe", "Costco");

/** Never send titles, notes, documents, raw transactions, identifiers or free-text requirements. */
export function publicBaseline(contract: SavingsContract): PublicBaseline {
  const keys = ["category", "price", "cycle", "taxesIncluded", "province", "cancellationFee", "annualLostDiscounts",
    "currentPromoMonths", "priceAfterPromo", "liabilityLimit", "collisionDeductible", "comprehensiveDeductible",
    "dataGb", "downloadMbps", "lines", "mortgageBalance", "mortgageRate", "amortizationYears", "termMonths", "rateType"] as const;
  const result = Object.fromEntries(keys.map(key => [key, contract[key]])) as unknown as PublicBaseline;
  if (contract.billing) { result.price = contract.billing.currency === "CAD" ? contractMonthly(contract) : null; result.cycle = "monthly"; result.taxesIncluded = contractTaxes(contract); result.priceAfterPromo = contract.billing.currency === "CAD" ? monthlyPrice(contract.priceAfterPromo,contract.cycle) : null; }
  result.provider = publicProviders.find(provider => provider.toLowerCase() === contract.provider.trim().toLowerCase()) || "Provider not disclosed";
  result.province = ["BC", "AB", "SK", "MB", "ON", "QC", "NB", "NS", "PE", "NL", "YT", "NT", "NU"].includes(contract.province) ? contract.province : "BC";
  return result;
}
/** A contract is counted once regardless of its number of services. Non-CAD stays separate. */
export function contractMonthly(contract: SavingsContract): number | null {
  const b = contract.billing;
  if (!b) return monthlyPrice(contract.price, contract.cycle);
  if (b.amount === null || !Number.isFinite(b.amount) || b.amount < 0 || !Number.isFinite(b.count) || b.count <= 0) return null;
  return b.amount / b.count * (b.unit === "months" ? 1 : b.unit === "years" ? 1 / 12 : b.unit === "weeks" ? 52 / 12 : 365.25 / 12);
}
export function contractTaxes(contract: SavingsContract): boolean | null {
  return contract.billing && Object.hasOwn(contract.billing,"taxesIncluded") ? contract.billing.taxesIncluded ?? null : contract.taxesIncluded;
}
export function recurringTotals(contracts: SavingsContract[]) {
  return contracts.reduce<Record<string, { amount: number; unknown: number }>>((totals, c) => {
    const currency = c.billing?.currency ?? "CAD", value = contractMonthly(c);
    const t = totals[currency] ??= { amount: 0, unknown: 0 };
    if (value === null) t.unknown++; else t.amount += value;
    return totals;
  }, {});
}
export function baselineKey(contract: SavingsContract): string {
  // Include local comparison requirements: changing them invalidates a prior result without disclosing them.
  return JSON.stringify([publicBaseline(contract), contract.provider, contract.needs, contract.discounts, contract.renewal, contract.commitmentEnd]);
}
export function monthlyPrice(price: number | null, cycle: SavingsContract["cycle"]): number | null {
  return price === null ? null : cycle === "annual" ? price / 12 : cycle === "weekly" ? price * 52 / 12 : price;
}
export function missingInformation(contract: SavingsContract): string[] {
  const missing: string[] = [];
  if (!contract.provider.trim()) missing.push("Current provider");
  if (contract.category !== "mortgage" && contractMonthly(contract) === null) missing.push("Current price");
  if (contract.billing && contract.billing.currency !== "CAD") missing.push("CAD comparison unavailable; no exchange rate assumed");
  if (contract.category !== "mortgage" && contractTaxes(contract) !== true) missing.push("Confirm all-in price including taxes and recurring fees");
  if (!contract.renewal) missing.push("Renewal or review date");
  if (!contract.needs.trim()) missing.push("Service, coverage and usage requirements");
  if (contract.cancellationFee === null) missing.push("Cancellation penalty (enter 0 if none)");
  if (contract.annualLostDiscounts === null) missing.push("Annual bundle/loyalty discounts lost (enter 0 if none)");
  if (contract.currentPromoMonths > 0 && contract.priceAfterPromo === null) missing.push("Price after current promotion");
  if (contract.category === "car-insurance") {
    if (contract.liabilityLimit === null) missing.push("Liability limit");
    if (contract.collisionDeductible === null) missing.push("Collision deductible");
    if (contract.comprehensiveDeductible === null) missing.push("Comprehensive deductible");
  }
  if (contract.category === "mortgage") {
    for (const [field, label] of [["mortgageBalance", "Balance"], ["mortgageRate", "Current rate"], ["amortizationYears", "Remaining amortization"], ["termMonths", "Comparison term in months"]] as const)
      if (contract[field] === null) missing.push(label);
  }
  return missing;
}
export function yearCost(monthly: number, after: number | null, months: number): number {
  const promo = Math.min(12, Math.max(0, months));
  return months === 0 ? monthly * 12 : monthly * promo + (after ?? monthly) * (12 - promo);
}
function mortgageInterest(balance: number, rate: number, years: number, months: number): { first: number; next: number } {
  const r = Math.pow(1 + rate / 200, 1 / 6) - 1;
  const n = Math.round(years * 12);
  const payment = r === 0 ? balance / n : balance * r / (1 - Math.pow(1 + r, -n));
  let first = 0, next = 0, remaining = balance;
  for (let month = 0; month < Math.min(months, 24, n); month++) {
    const interest = remaining * r;
    remaining = Math.max(0, remaining + interest - payment);
    if (month < 12) first += interest; else next += interest;
  }
  return { first, next };
}
export function compareOffer(contract: SavingsContract, offer: SavingsOffer, now = new Date(), requirementsReviewed = false): {
  firstYear: number | null; ongoingAnnual: number | null; reasons: string[]; metric: "cost" | "interest"
} {
  const reasons: string[] = [];
  const metric = contract.category === "mortgage" ? "interest" : "cost";
  if (!offer.comparable) reasons.push("Service or coverage match needs confirmation");
  if (!contract.needs.trim()) reasons.push("Service and coverage requirements are missing");
  // Free-text benefits and add-ons stay local: public research cannot certify this private comparison.
  if (!requirementsReviewed)
    reasons.push("Review all policy add-ons or service benefits against your saved requirements");
  if (contract.cancellationFee === null || contract.annualLostDiscounts === null || offer.upfrontFees === null || offer.annualLostDiscounts === null)
    reasons.push("Switching fees or lost discounts are unknown");
  const checked = Date.parse(offer.checkedAt);
  if (!Number.isFinite(checked) || checked > now.getTime() + 86_400_000 || now.getTime() - checked > 30 * 86_400_000)
    reasons.push("Offer needs a fresh public-price check");
  if (offer.validUntil && Date.parse(offer.validUntil + "T23:59:59Z") < now.getTime()) reasons.push("Offer has expired");
  if (!offer.sources.length) reasons.push("No verifiable public source");
  if (contract.category === "car-insurance" && (offer.liabilityLimit !== contract.liabilityLimit || offer.collisionDeductible !== contract.collisionDeductible || offer.comprehensiveDeductible !== contract.comprehensiveDeductible || contract.liabilityLimit === null || contract.collisionDeductible === null || contract.comprehensiveDeductible === null))
    reasons.push("Liability limits and deductibles do not match");
  const fees = (offer.upfrontFees ?? 0) + (contract.cancellationFee ?? 0);
  // One total for all discounts lost, never add a research estimate to the same entered baseline loss.
  const lost = Math.max(contract.annualLostDiscounts ?? 0, offer.annualLostDiscounts ?? 0);
  let firstYear: number | null = null, ongoingAnnual: number | null = null;
  if (metric === "interest") {
    if (contract.rateType === "variable" || offer.rateType === "variable") reasons.push("Variable-rate scenario requires a rate-path estimate");
    if (contract.mortgageBalance === null || contract.mortgageRate === null || contract.amortizationYears === null || contract.termMonths === null || offer.mortgageRate === null)
      reasons.push("Mortgage terms are incomplete");
    if (offer.termMonths !== contract.termMonths || offer.amortizationYears !== contract.amortizationYears || offer.rateType !== contract.rateType)
      reasons.push("Mortgage term or amortization differs");
    if (contract.termMonths !== null && contract.termMonths < 12)
      reasons.push("A full first-year comparison requires at least 12 months of comparable terms");
    if (contract.mortgageBalance !== null && contract.mortgageRate !== null && contract.amortizationYears && contract.termMonths && offer.mortgageRate !== null) {
      const current = mortgageInterest(contract.mortgageBalance, contract.mortgageRate, contract.amortizationYears, contract.termMonths);
      const alternative = mortgageInterest(contract.mortgageBalance, offer.mortgageRate, contract.amortizationYears, contract.termMonths);
      firstYear = current.first - alternative.first - fees - lost;
      ongoingAnnual = contract.termMonths >= 24 ? current.next - alternative.next - lost : null;
    }
  } else {
    const current = contract.billing?.currency && contract.billing.currency !== "CAD" ? null : contractMonthly(contract);
    if (current === null || offer.monthlyPrice === null || contractTaxes(contract) !== true || !offer.taxesIncluded)
      reasons.push("All-in current or alternative price is unknown");
    if ((contract.currentPromoMonths > 0 && contract.priceAfterPromo === null) || (offer.promoMonths > 0 && offer.monthlyPriceAfterPromo === null)) reasons.push("Price after promotion is unknown");
    if (current !== null && offer.monthlyPrice !== null) {
      const currentAfter = monthlyPrice(contract.priceAfterPromo, contract.cycle);
      firstYear = yearCost(current, currentAfter, contract.currentPromoMonths) - yearCost(offer.monthlyPrice, offer.monthlyPriceAfterPromo, offer.promoMonths) - fees - lost;
      ongoingAnnual = ((contract.currentPromoMonths > 0 ? currentAfter : current) ?? current) * 12 - (offer.promoMonths > 0 ? offer.monthlyPriceAfterPromo ?? offer.monthlyPrice : offer.monthlyPrice) * 12 - lost;
    }
  }
  const unknown = reasons.some(reason => !reason.startsWith("Review all policy"));
  return { firstYear: unknown ? null : firstYear, ongoingAnnual: unknown ? null : ongoingAnnual, reasons, metric };
}
export function shortlistTotal(entries: { contract: SavingsContract; offer: SavingsOffer; reviewed: boolean }[]): { firstYear: number; count: number; excluded: number } {
  const used = new Set<string>(); let firstYear = 0, count = 0, excluded = 0;
  const ranked = [...entries].sort((a, b) => (compareOffer(b.contract, b.offer, new Date(), b.reviewed).firstYear ?? -Infinity) - (compareOffer(a.contract, a.offer, new Date(), a.reviewed).firstYear ?? -Infinity));
  for (const { contract, offer, reviewed } of ranked) {
    const result = compareOffer(contract, offer, new Date(), reviewed);
    const affected = new Set([contract.id, ...offer.affectedContractIds]);
    if (!reviewed || result.reasons.length || result.firstYear === null || result.firstYear <= 0 || [...affected].some(id => used.has(id))) { excluded++; continue; }
    affected.forEach(id => used.add(id)); firstYear += result.firstYear; count++;
  }
  return { firstYear, count, excluded };
}
