import { normalizedSize, type GroceryPlan, type GroceryPrice, type GroceryRetailer, type ShoppingItem } from "../../worker/src/grocery-planning";
import { currentPrices, datedPrice, type StoreGroup } from "./grocery-comparison";

type Basis = "each" | "kg" | "l" | "uses";
export type UnitRate = { amount: number; basis: Basis; label: string };
export type RankedOffer = {
  r: GroceryRetailer; p: GroceryPrice; rate: UnitRate | null; reason: string;
  percent: number | null; gap: string; tone: "minimum" | "higher" | "neutral";
};
const uncertainFormat = /format (?:non confirmé|à confirmer)/i;
const estimatedPackage = /prix (?:de barquette )?estimé/i;
const equalRate = (a: number, b: number) => Math.abs(a - b) <= Number.EPSILON * Math.max(Math.abs(a), Math.abs(b), Number.MIN_VALUE) * 8;

function countLabel(item: ShoppingItem) {
  const labels: Record<string, string> = { "œufs": "œuf", "tranches": "tranche", "poitrines": "poitrine", "muffins entiers équivalents": "muffin", "muffins": "muffin" };
  return labels[item.countUnit ?? ""] ?? "unité";
}
/** A sourced physical format or labelled capacity; never guesses density, slices or dose. */
export function observedUnitRate(item: ShoppingItem, p: GroceryPrice): UnitRate | null {
  if (!Number.isFinite(p.price) || p.price < 0 || !Number.isFinite(p.size) || p.size <= 0 || uncertainFormat.test(p.matchNote ?? "") || estimatedPackage.test(p.matchNote ?? "")) return null;
  if (item.measure === "uses" && p.usesPerPack !== null && p.usesPerPack !== undefined) {
    if (!Number.isFinite(p.usesPerPack) || p.usesPerPack <= 0) return null;
    const label = item.countUnit === "charges" ? "charge (étiquette)" : item.countUnit === "cycles" ? "cycle (étiquette)" : "utilisation (étiquette)";
    const amount = p.price / p.usesPerPack;
    return Number.isFinite(amount) ? { amount, basis: "uses", label } : null;
  }
  const size = normalizedSize(p.size, p.unit);
  if (!["each", "kg", "l"].includes(size.unit) || !Number.isFinite(size.size) || size.size <= 0 || p.weighed && size.unit === "each") return null;
  const amount = p.price / size.size;
  return Number.isFinite(amount) ? { amount, basis: size.unit as Basis, label: size.unit === "each" ? countLabel(item) : size.unit } : null;
}
function eligibilityReason(plan: GroceryPlan, r: GroceryRetailer, p: GroceryPrice, now?: string) {
  if (r.enabled === false) return "Magasin hors comparaison";
  if (p.currency !== plan.currency) return "Devise différente";
  if (p.available === "no") return "Indisponible selon source";
  if (!datedPrice(p, now)) return "Prix historique ou à actualiser";
  if ((Date.parse(now ?? new Date().toISOString().slice(0, 10)) - Date.parse(p.evidence.date)) / 86400000 > 7) return "Observation ancienne, à actualiser";
  if (/catalogue par défaut/i.test(r.name)) return "Catalogue non local";
  if (!p.mode || p.mode === "unknown" || p.mode !== r.mode) return "Mode du prix à confirmer";
  if (uncertainFormat.test(p.matchNote ?? "")) return "Format non confirmé";
  if (estimatedPackage.test(p.matchNote ?? "")) return "Prix de paquet estimé";
  return "";
}
/** Positive gaps never round to a misleading +0%. The zero minimum has no ratio. */
export function unitPercentLabel(percent: number) {
  if (percent > 0 && percent + 1e-10 < .1) return "+<0,1 %";
  return "+" + new Intl.NumberFormat("fr-CA", { maximumFractionDigits: 1 }).format(percent) + " %";
}
export function formatUnitRate(rate: UnitRate, currency: string) {
  const amount = rate.amount > 0 && rate.amount < .0001 ? "<0,0001" : new Intl.NumberFormat("fr-CA", { maximumFractionDigits: 4 }).format(rate.amount);
  return `${amount} ${currency}/${rate.label}`;
}

/** Read-only display ranking, not product equivalence, approval or a basket recommendation.
 * Known purchase modes can be compared as observed product rates, before per-order fees.
 * Only one currency/dimension is ranked per article; other units remain visible and neutral.
 */
export function articleUnitComparison(plan: GroceryPlan, item: ShoppingItem, groups: StoreGroup[], now?: string) {
  const rows = groups.map((group, index) => {
    const all = group.retailers.flatMap(r => currentPrices(plan, item, r, now).map(p => ({ r, p })));
    const visible = all.some(o => !/catalogue par défaut/i.test(o.r.name)) ? all.filter(o => !/catalogue par défaut/i.test(o.r.name)) : all;
    const offers: RankedOffer[] = visible.map(({ r, p }) => {
      const rate = observedUnitRate(item, p);
      return { r, p, rate, reason: eligibilityReason(plan, r, p, now) || (!rate ? "Format ou capacité non calculable" : ""), percent: null, gap: "Non comparable", tone: "neutral" };
    });
    return { group, index, offers, rank: null as number | null };
  });
  const candidates = rows.flatMap(row => row.offers).filter(o => !o.reason && o.rate);
  const dimensions = [...new Set(candidates.map(o => o.rate!.basis))];
  const expected = item.measure === "uses" && dimensions.includes("uses") ? "uses" : item.unit ? normalizedSize(1, item.unit).unit : null;
  // Prefer the requested unit when evidenced, otherwise the most represented physical unit.
  const basis = dimensions.find(b => b === expected) ?? dimensions.sort((a, b) => candidates.filter(o => o.rate!.basis === b).length - candidates.filter(o => o.rate!.basis === a).length)[0] ?? null;
  const comparable = candidates.filter(o => o.rate!.basis === basis);
  const minimum = comparable.length ? Math.min(...comparable.map(o => o.rate!.amount)) : null;
  const ties = minimum === null ? 0 : comparable.filter(o => equalRate(o.rate!.amount, minimum)).length;
  for (const row of rows) {
    for (const offer of row.offers) {
      if (!offer.reason && offer.rate?.basis !== basis) offer.reason = "Unité différente";
      if (offer.reason || !offer.rate || minimum === null) continue;
      row.rank = row.rank === null ? offer.rate.amount : Math.min(row.rank, offer.rate.amount);
      if (comparable.length < 2) { offer.gap = "Seul prix comparable"; continue; }
      if (minimum === 0) { offer.gap = offer.rate.amount === 0 ? "Prix nul observé" : "Écart non calculable"; continue; }
      const percent = (offer.rate.amount / minimum - 1) * 100;
      if (equalRate(offer.rate.amount, minimum)) {
        offer.percent = 0; offer.gap = ties > 1 ? "Ex æquo · 0 %" : "Plus bas observé · 0 %"; offer.tone = "minimum";
      } else if (Number.isFinite(percent) && percent > 0) {
        offer.percent = percent; offer.gap = unitPercentLabel(percent); offer.tone = "higher";
      } else { offer.gap = "Écart non calculable"; }
    }
    // Sort variants without merging their formats or modes.
    row.offers = row.offers.map((offer, index) => ({ offer, index })).sort((a, b) => {
      const x = a.offer, y = b.offer, rankedX = !x.reason && x.rate?.basis === basis, rankedY = !y.reason && y.rate?.basis === basis;
      if (rankedX !== rankedY) return rankedX ? -1 : 1;
      return rankedX && rankedY && !equalRate(x.rate!.amount, y.rate!.amount) ? x.rate!.amount - y.rate!.amount : a.index - b.index;
    }).map(o => o.offer);
  }
  rows.sort((a, b) => {
    if (a.rank === null || b.rank === null) return a.rank === b.rank ? a.index - b.index : a.rank === null ? 1 : -1;
    return equalRate(a.rank, b.rank) ? a.index - b.index : a.rank - b.rank;
  });
  return { rows, basis, minimum, comparableCount: comparable.length };
}

/** Count competing stores, not multiple formats at a single store. No need quantity required. */
export function articleComparisonCoverage(plan: GroceryPlan, groups: StoreGroup[], now?: string) {
  const items = plan.items.filter(i => i.active);
  const comparable = items.filter(item => articleUnitComparison(plan, item, groups, now).rows.filter(row => row.rank !== null).length >= 2);
  return { count: comparable.length, total: items.length };
}
