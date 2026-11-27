import { localToday, type SpendingTrend } from "./finance-trends";

type Trend = Pick<SpendingTrend, "actualCents" | "baselineCents" | "baselineReady" | "referenceIndicative" | "categories">;
export type CategoryDifference = {
  key: string; label: string; categoryKeys: string[];
  actualCents: number; baselineCents: number; differenceCents: number;
  displayActualCents: number; displayBaselineCents: number; displayDifferenceCents: number;
};
export type TrendAttribution = {
  available: boolean;
  unavailableReason: "observed-unavailable" | "reference-unavailable" | "inconsistent-categories" | null;
  indicative: boolean;
  actualCents: number | null; baselineCents: number | null; differenceCents: number | null;
  displayDifferenceCents: number | null;
  categories: CategoryDifference[];
  scaleCents: number | null;
};

/** Open the chosen month, otherwise today's month; never silently substitute the latest capture. */
export function trendEntryMonth(selectedMonth?: string, today = localToday()): string {
  const month = selectedMonth ?? today.slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Mois invalide");
  return month;
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const equalCents = (a: number, b: number) => Math.abs(a - b) <= Math.max(1e-7, Math.abs(b) * Number.EPSILON * 32);

/**
 * Presentation only: preserve the existing observed/reference arithmetic. Reference
 * means may contain fractions of a cent. Distribute display rounding across categories
 * (largest remainder, stable key ties) so their displayed differences reconcile exactly
 * to the displayed headline. This never changes finance-trends or persisted source facts.
 */
export function attributeSpendingDifference(trend: Trend): TrendAttribution {
  const result: TrendAttribution = {
    available: false, unavailableReason: null, indicative: trend.referenceIndicative,
    actualCents: trend.actualCents, baselineCents: trend.baselineCents, differenceCents: null,
    displayDifferenceCents: null, categories: [], scaleCents: null,
  };
  if (trend.actualCents === null) return { ...result, unavailableReason: "observed-unavailable" };
  if (!trend.baselineReady || trend.baselineCents === null) return { ...result, unavailableReason: "reference-unavailable" };
  const rows = trend.categories;
  if (!Number.isSafeInteger(trend.actualCents) || !Number.isFinite(trend.baselineCents) ||
      new Set(rows.map(row => row.key)).size !== rows.length ||
      rows.some(row => row.actualCents === null || !Number.isSafeInteger(row.actualCents) || row.baselineCents === null || !Number.isFinite(row.baselineCents)) ||
      !equalCents(sum(rows.map(row => row.actualCents!)), trend.actualCents) ||
      !equalCents(sum(rows.map(row => row.baselineCents!)), trend.baselineCents)) {
    return { ...result, unavailableReason: "inconsistent-categories" };
  }
  const displayReference = rows.map(row => Math.floor(row.baselineCents!));
  const remainder = Math.round(trend.baselineCents) - sum(displayReference);
  if (remainder < 0 || remainder > rows.length) return { ...result, unavailableReason: "inconsistent-categories" };
  const order = rows.map((row, index) => ({ index, key: row.key, remainder: row.baselineCents! - displayReference[index] }))
    .sort((a, b) => b.remainder - a.remainder || a.key.localeCompare(b.key));
  for (let index = 0; index < remainder; index++) displayReference[order[index].index]++;
  const categories: CategoryDifference[] = rows.map((row, index) => ({
    key: row.key, label: row.label, categoryKeys: [row.key],
    actualCents: row.actualCents!, baselineCents: row.baselineCents!, differenceCents: row.actualCents! - row.baselineCents!,
    displayActualCents: row.actualCents!, displayBaselineCents: displayReference[index], displayDifferenceCents: row.actualCents! - displayReference[index],
  })).sort((a, b) => Math.abs(b.differenceCents) - Math.abs(a.differenceCents) || a.key.localeCompare(b.key));
  return {
    ...result, available: true, differenceCents: trend.actualCents - trend.baselineCents,
    displayDifferenceCents: trend.actualCents - Math.round(trend.baselineCents), categories,
    scaleCents: Math.max(1, ...categories.map(row => Math.abs(row.displayDifferenceCents))),
  };
}

/** Compact A overview; B can use all categories. The remainder is never silently dropped. */
export function leadingSpendingDifferences(attribution: TrendAttribution, limit = 3): CategoryDifference[] {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("Invalid category count");
  if (!attribution.available) return [];
  const leaders = attribution.categories.slice(0, limit), remainder = attribution.categories.slice(limit);
  if (!remainder.length) return leaders;
  return [...leaders, {
    key: "remaining-categories", label: "Other categories", categoryKeys: remainder.flatMap(row => row.categoryKeys),
    actualCents: sum(remainder.map(row => row.actualCents)), baselineCents: sum(remainder.map(row => row.baselineCents)), differenceCents: sum(remainder.map(row => row.differenceCents)),
    displayActualCents: sum(remainder.map(row => row.displayActualCents)), displayBaselineCents: sum(remainder.map(row => row.displayBaselineCents)), displayDifferenceCents: sum(remainder.map(row => row.displayDifferenceCents)),
  }];
}
