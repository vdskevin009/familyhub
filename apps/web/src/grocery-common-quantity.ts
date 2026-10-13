import { normalizedSize, type GroceryPlan, type ShoppingItem } from "../../worker/src/grocery-planning";
import { storeGroups } from "./grocery-comparison";
import { articleUnitComparison, unitPercentLabel, type RankedOffer } from "./grocery-unit-comparison";

export const adjustedNumber = (n: number) => n > 0 && n < .0001 ? "<0,0001" : new Intl.NumberFormat("fr-CA", { maximumFractionDigits: 4 }).format(n);
export const adjustedMoney = (n: number, currency: string) => `${n > 0 && n < .01 ? "<0,01" : new Intl.NumberFormat("fr-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} ${currency}`;

type ComparisonBasis = NonNullable<RankedOffer["rate"]>["basis"];
function target(item: ShoppingItem, basis?: ComparisonBasis | null) {
  const quantity = item.basketQuantity !== undefined ? item.basketQuantity : item.quantity;
  if (quantity !== null && (!Number.isFinite(quantity) || quantity <= 0)) return null;
  if (item.size !== null && (!Number.isFinite(item.size) || item.size <= 0)) return null;
  let known: { quantity: number; basis: string; pack: number | null; label: string; reference: boolean } | null = null;
  if (quantity !== null) {
    if (item.measure === "uses") known = { quantity, basis: "uses", pack: null, label: item.countUnit || "utilisations", reference: false };
    else if (item.size !== null && item.unit) {
      const pack = normalizedSize(item.size, item.unit);
      known = { quantity: quantity * pack.size, basis: pack.unit, pack: pack.size, label: pack.unit === "each" ? item.countUnit || "unités" : pack.unit, reference: false };
    }
  }
  if (known && (!basis || known.basis === basis)) return known;
  if (!basis) return null;
  // Reference quantities are a separate comparison scenario, never a conversion of a
  // portion/slice to weight, uses to volume, or a known mass to volume.
  if (known && known.basis !== "uses" && !(known.basis === "each" && item.measure !== "pack" && (basis === "kg" || basis === "l"))) return null;
  return { quantity: 1, basis, pack: null, label: basis === "uses" ? item.countUnit || "utilisations" : basis === "each" ? "unités" : basis, reference: true };
}
export type CommonLine = { item: ShoppingItem; offer: RankedOffer; quantity: number; label: string; pack: number; normalized: number; packs: number; purchase: number; selection: string; reference: boolean };

export function adjustedOfferQuantity(item: ShoppingItem, offer: RankedOffer): CommonLine | null {
  const need = target(item, offer.rate?.basis);
  if (!need || offer.reason || !offer.rate || offer.rate.basis !== need.basis) return null;
  const pack = need.basis === "uses" ? offer.p.usesPerPack! : normalizedSize(offer.p.size, offer.p.unit).size;
  const ratio = need.quantity / pack, packs = offer.p.weighed ? ratio : Math.ceil(ratio - Number.EPSILON * Math.max(1, ratio) * 4);
  const normalized = need.quantity * offer.rate.amount, purchase = packs * offer.p.price;
  if (![need.quantity, pack, normalized, packs, purchase].every(Number.isFinite) || packs <= 0 || purchase > 1_000_000) return null;
  return { item, offer, quantity: need.quantity, label: need.label, pack, normalized, packs, purchase, reference: need.reference, selection: need.reference ? "Quantité de référence identique entre magasins ; elle ne définit pas le besoin habituel." : need.pack === null ? "Format souhaité inconnu : prix unitaire observé le plus bas, hypothèse à revoir." : "Format compatible le plus proche du format souhaité ; égalité départagée au prix unitaire." };
}

/** Display-only estimate: one identical subset/quantity at every participating store.
 * Authorized reference quantities fill unknown physical amounts only for display.
 * Candidate products remain unreviewed; no density/dose or household quantity is inferred.
 */
export function commonQuantityComparison(plan: GroceryPlan, now?: string, selectedStores?: readonly string[]) {
  const groups = storeGroups(plan).filter(g => selectedStores === undefined || selectedStores.includes(g.name)), items = plan.items.filter(i => i.active);
  const candidates = items.map(item => {
    const comparison = articleUnitComparison(plan, item, groups, now);
    const need = target(item, comparison.basis);
    const rows = comparison.rows.map(row => {
      const options = need ? row.offers.filter(o => !o.reason && o.rate?.basis === need.basis && o.p.available !== "no") : [];
      const packSize = (o: RankedOffer) => need?.basis === "uses" ? o.p.usesPerPack! : normalizedSize(o.p.size, o.p.unit).size;
      options.sort((a, b) => need?.pack !== null && need?.pack !== undefined
        ? Math.abs(packSize(a) - need.pack) - Math.abs(packSize(b) - need.pack) || a.rate!.amount - b.rate!.amount
        : a.rate!.amount - b.rate!.amount);
      const offer = options[0];
      if (!need || !offer) return { group: row.group, line: null };
      return { group: row.group, line: adjustedOfferQuantity(item, offer) };
    });
    return { item, need, rows };
  });
  // An explicitly chosen store must never disappear just because its references are missing.
  const participants = selectedStores === undefined ? groups.filter(g => candidates.some(c => c.rows.some(r => r.group.name === g.name && r.line))) : groups;
  const shared = participants.length ? candidates.filter(c => participants.every(g => c.rows.some(r => r.group.name === g.name && r.line))) : [];
  const stores = groups.map(group => {
    const lines = shared.flatMap(c => { const line = c.rows.find(r => r.group.name === group.name)?.line; return line ? [line] : []; });
    const amount = lines.length ? lines.reduce((n, l) => n + l.normalized, 0) : null;
    return { group, lines, amount, gap: "Non comparable", percent: null as number | null };
  });
  const comparable = stores.filter(s => s.amount !== null), minimum = comparable.length ? Math.min(...comparable.map(s => s.amount!)) : null;
  for (const s of comparable) {
    if (comparable.length < 2) { s.gap = "Seul montant"; continue; }
    if (minimum === 0) { s.gap = s.amount === 0 ? "Montant nul" : "Écart inconnu"; continue; }
    const gap = (s.amount! / minimum! - 1) * 100;
    if (!Number.isFinite(gap)) { s.gap = "Écart inconnu"; continue; }
    const tied = Math.abs(gap) <= Number.EPSILON * 800;
    s.percent = tied ? 0 : gap;
    s.gap = tied ? comparable.filter(other => Math.abs((other.amount! / minimum! - 1) * 100) <= Number.EPSILON * 800).length > 1 ? "0 % ex æquo" : "0 %" : unitPercentLabel(gap);
  }
  // Rank only the identical shared base, never a store's partial raw subtotal.
  stores.sort((a, b) => (a.amount === null ? 1 : 0) - (b.amount === null ? 1 : 0)
    || (a.amount !== null && b.amount !== null ? a.amount - b.amount : 0)
    || a.group.name.localeCompare(b.group.name, "fr-CA"));
  const excluded = items.filter(i => !shared.some(c => c.item.id === i.id));
  const exclusionDetails = excluded.map(item => {
    const missing = participants.filter(g => !candidates.find(c => c.item.id === item.id)?.rows.some(r => r.group.name === g.name && r.line)).map(g => g.name);
    return { item, reason: missing.length ? `Référence dans une même unité manquante ou non comparable : ${missing.join(", ")}.` : "Choisissez au moins un magasin pour calculer le total." };
  });
  return { stores, count: shared.length, total: items.length, excluded, exclusionDetails, participants: participants.length, referenceCount: shared.filter(c => c.need?.reference).length, participantNames: participants.map(g => g.name) };
}
