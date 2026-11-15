import type { GroceryRecord, GroceryUnit } from "./grocery-model.js";
import { normalizedSize, publicSourceUrl, type GroceryPrice } from "./grocery-planning.js";

/** A saved search/category URL is a lead, never a product-price observation. No fetching. */
export function scenarioProductSource(url: string): boolean {
  try {
    const source = publicSourceUrl(url);
    if (!source) return false;
    const u = new URL(source);
    return !/(?:^|\/)(?:search|results|categories|category|pages|s)(?:\/|$)/i.test(u.pathname)
      && !["q", "query", "search", "searchTerm", "k"].some(key => u.searchParams.has(key));
  } catch { return false; }
}

export function independentReceiptPrice(price: GroceryPrice, record: GroceryRecord, records: GroceryRecord[]) {
  const ids = price.evidence.title.split(/[^a-zA-Z0-9_-]+/);
  const sources = records.filter(r => ids.includes(r.id));
  if (sources.length !== 1) return null;
  const source = sources[0];
  if (source.id === record.id || source.duplicateOf || source.status !== "saved" || !source.reviewedAt
    || source.receipt.sourceType !== "final-receipt" || source.receipt.currency !== price.currency
    || source.receipt.reference && source.receipt.reference === record.receipt.reference && source.receipt.store === record.receipt.store) return null;
  const rows = source.receipt.items.filter(l => l.product === price.product && l.amount !== null && Math.abs(l.amount - price.price) < .001);
  if (rows.length !== 1) return null;
  const line = rows[0];
  if (line.quantity !== null && (!Number.isFinite(line.quantity) || line.quantity <= 0)) return null;
  if (line.size !== null && line.unit) {
    const a = normalizedSize(line.size, line.unit), b = normalizedSize(price.size, price.unit);
    if (a.unit !== b.unit || Math.abs(a.size - b.size) > 1e-9 * Math.max(a.size, b.size)) return null;
  }
  return { source, line };
}

/** Only explicit mass/volume declarations. Nutrition, ranges and ambiguous counts abstain. */
export function explicitScenarioFormat(title: string): { size: number; unit: GroceryUnit } | null {
  const s = title.toLowerCase().replace(/,/g, ".");
  if (/\bper\b|\bpar\b|\d\s*[-–]\s*\d|\d\s*(?:g|kg|ml|l|oz|lb)\s*[-–]|\d\s*g\s*(?:of\s+)?(?:protein|fibre|fiber|sugar|fat)/.test(s)) return null;
  const rows = [...s.matchAll(/(?<![\w.])(?:(\d+)\s*[x×]\s*)?(\d+(?:\.\d+)?)\s*(kg|g|ml|l|lbs?|oz)\b/g)];
  if (rows.length !== 1) return null;
  const [, count, amount, rawUnit] = rows[0];
  const size = Number(count ?? 1) * Number(amount) * (/^lb/.test(rawUnit) ? 453.59237 : rawUnit === "oz" ? 28.349523125 : 1);
  return size > 0 && size <= 100000 ? {size,unit:/^lb|^oz/.test(rawUnit)?"g":rawUnit as GroceryUnit} : null;
}

/** Relative floating-point tolerance, never rounds a positive tiny need down to zero packs. */
export const wholeScenarioPacks = (ratio: number) => Math.max(1, Math.ceil(ratio - Number.EPSILON * Math.max(1, ratio) * 4));
