import { normalizedSize, type GroceryPlan, type ShoppingItem } from "../../worker/src/grocery-planning";
import { storeGroups } from "./grocery-comparison";
import { articleUnitComparison, unitPercentLabel, type RankedOffer } from "./grocery-unit-comparison";

export const adjustedNumber = (n: number) => n > 0 && n < .0001 ? "<0,0001" : new Intl.NumberFormat("fr-CA", { maximumFractionDigits: 4 }).format(n);
export const adjustedMoney = (n: number, currency: string) => `${n > 0 && n < .01 ? "<0,01" : new Intl.NumberFormat("fr-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} ${currency}`;

function target(item: ShoppingItem) {
  const quantity = item.basketQuantity !== undefined ? item.basketQuantity : item.quantity;
  if (quantity === null || !Number.isFinite(quantity) || quantity <= 0) return null;
  if (item.measure === "uses") return { quantity, basis: "uses", pack: null, label: item.countUnit || "utilisations" };
  if (item.size === null || !item.unit || !Number.isFinite(item.size) || item.size <= 0) return null;
  const pack = normalizedSize(item.size, item.unit);
  return { quantity: quantity * pack.size, basis: pack.unit, pack: pack.size, label: pack.unit === "each" ? item.countUnit || "unités" : pack.unit };
}
export type CommonLine = { item: ShoppingItem; offer: RankedOffer; quantity: number; label: string; pack: number; normalized: number; packs: number; purchase: number; selection: string };

export function adjustedOfferQuantity(item: ShoppingItem, offer: RankedOffer): CommonLine | null {
  const need = target(item);
  if (!need || offer.reason || !offer.rate || offer.rate.basis !== need.basis) return null;
  const pack = need.basis === "uses" ? offer.p.usesPerPack! : normalizedSize(offer.p.size, offer.p.unit).size;
  const ratio = need.quantity / pack, packs = offer.p.weighed ? ratio : Math.ceil(ratio - Number.EPSILON * Math.max(1, ratio) * 4);
  const normalized = need.quantity * offer.rate.amount, purchase = packs * offer.p.price;
  if (![need.quantity, pack, normalized, packs, purchase].every(Number.isFinite) || packs <= 0 || purchase > 1_000_000) return null;
  return { item, offer, quantity: need.quantity, label: need.label, pack, normalized, packs, purchase, selection: need.pack === null ? "Format souhaité inconnu : prix unitaire observé le plus bas, hypothèse à revoir." : "Format compatible le plus proche du format souhaité ; égalité départagée au prix unitaire." };
}

/** Display-only estimate: one identical subset/quantity at every participating store.
 * Candidate products remain unreviewed; no density/dose or new household quantity is inferred.
 */
export function commonQuantityComparison(plan: GroceryPlan, now?: string) {
  const groups = storeGroups(plan), items = plan.items.filter(i => i.active);
  const candidates = items.map(item => {
    const need = target(item);
    const rows = articleUnitComparison(plan, item, groups, now).rows.map(row => {
      const options = need ? row.offers.filter(o => !o.reason && o.rate?.basis === need.basis && o.p.available !== "no") : [];
      const packSize = (o: RankedOffer) => need?.basis === "uses" ? o.p.usesPerPack! : normalizedSize(o.p.size, o.p.unit).size;
      options.sort((a, b) => need?.pack !== null && need?.pack !== undefined
        ? Math.abs(packSize(a) - need.pack) - Math.abs(packSize(b) - need.pack) || a.rate!.amount - b.rate!.amount
        : a.rate!.amount - b.rate!.amount);
      const offer = options[0];
      if (!need || !offer) return { group: row.group, line: null };
      return { group: row.group, line: adjustedOfferQuantity(item, offer) };
    });
    return { item, rows };
  });
  const participants = groups.filter(g => candidates.some(c => c.rows.some(r => r.group.name === g.name && r.line)));
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
    s.percent = gap; s.gap = Math.abs(gap) <= Number.EPSILON * 800 ? "0 %" : unitPercentLabel(gap);
  }
  // Rank only the identical shared base, never a store's partial raw subtotal.
  stores.sort((a, b) => (a.amount === null ? 1 : 0) - (b.amount === null ? 1 : 0)
    || (a.amount !== null && b.amount !== null ? a.amount - b.amount : 0)
    || a.group.name.localeCompare(b.group.name, "fr-CA"));
  return { stores, count: shared.length, total: items.length, excluded: items.filter(i => !shared.some(c => c.item.id === i.id)), participants: participants.length };
}
