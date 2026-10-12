import { normalizedSize, offerQuantity, type GroceryPlan, type GroceryPrice, type GroceryRetailer, type ShoppingItem } from "../../worker/src/grocery-planning";

export const comparisonStores = ["Fresh St. Market", "Walmart", "Costco", "Superstore"];
export type StoreGroup = { name: string; retailers: GroceryRetailer[] };
export function storeName(name: string) {
  if (/^fresh\s*(?:st\.?|street)/i.test(name)) return "Fresh St. Market";
  return comparisonStores.find(s => name.toLocaleLowerCase().startsWith(s.toLocaleLowerCase())) ?? name;
}
export function storeGroups(plan: GroceryPlan): StoreGroup[] {
  const names = [...comparisonStores, ...plan.retailers.map(r => storeName(r.name)).filter(n => !comparisonStores.includes(n))];
  return [...new Set(names)].map(name => ({ name, retailers: plan.retailers.filter(r => storeName(r.name) === name) }));
}
export function currentPrices(plan: GroceryPlan, item: ShoppingItem, retailer: GroceryRetailer, now?: string) {
  const rows = plan.prices.filter(p => p.itemId === item.id && p.retailerId === retailer.id);
  const dated = rows.filter(p => datedPrice(p, now));
  const pool = dated.length ? dated : rows;
  const date = pool.reduce((d, p) => p.evidence.date > d ? p.evidence.date : d, "");
  return pool.filter(p => p.evidence.date === date);
}
export function datedPrice(p: GroceryPrice, now = new Date().toISOString().slice(0, 10)) {
  return p.kind !== "receipt" && !!p.evidence.date && p.evidence.date <= now && (!p.evidence.until || p.evidence.until >= now);
}
export function shortProduct(product: string) {
  const brands = ["Kirkland Signature", "President's Choice", "President’s Choice", "Great Value", "Our Finest", "Earth's Own", "Earth’s Own", "Blue Diamond", "Almond Breeze", "Golden Valley", "Golden West", "No Name", "Baby Mum-Mum", "Hot Kid", "Nature Clean", "Your Fresh Market", "Antonio Amato", "Dempster's", "Dempster’s", "Fresh Local", "Liberté", "Liberte", "Oikos", "Armstrong", "Lightlife", "Riscossa", "Fiorfiore", "Lilydale", "Cascade", "Purex", "Tide", "Gain"];
  return brands.find(b => product.toLocaleLowerCase().startsWith(b.toLocaleLowerCase())) ?? product;
}
export function formatLabel(p: GroceryPrice, item: ShoppingItem) {
  if (/format (?:non confirmé|à confirmer)/i.test(p.matchNote ?? "")) return "Format à vérifier";
  const count = item.countUnit?.startsWith("muffins entiers") ? "muffins" : item.countUnit;
  return `${p.size} ${p.unit === "each" ? count && item.measure !== "uses" ? count : p.size === 1 ? "unité" : "unités" : p.unit}`;
}
export function priceState(p: GroceryPrice, retailer: GroceryRetailer, now?: string) {
  if (p.available === "no") return "Indisponible selon source";
  if (p.kind === "receipt") return "Prix de ticket";
  if (!datedPrice(p, now)) return "À actualiser";
  if (/catalogue par défaut/i.test(retailer.name)) return "Autre catalogue";
  if (/format (?:non confirmé|à confirmer)/i.test(p.matchNote ?? "")) return "Format à vérifier";
  if (/prix (?:de barquette )?estimé/i.test(p.matchNote ?? "")) return "Prix de paquet estimé";
  if (/taux BASE.*avant remise/i.test(p.matchNote ?? "")) return "Avant remise par paquet";
  if (retailer.enabled === false) return "Hors comparaison";
  if (!p.mode || p.mode === "unknown" || p.mode !== (retailer.mode ?? "unknown")) return "Mode à vérifier";
  if (!p.approved || !p.localityConfirmed) return p.substitution ? "Équivalent à revoir" : "À vérifier";
  return "Revu";
}
export function quantityReason(item: ShoppingItem, p?: GroceryPrice) {
  if ((item.basketQuantity !== undefined ? item.basketQuantity : item.quantity) === null) return "Quantité du besoin inconnue";
  if (!p) return "Pas encore de prix sourcé";
  if (/format (?:non confirmé|à confirmer)/i.test(p.matchNote ?? "")) return "Format de référence à confirmer";
  if (item.measure === "pack") {
    if (item.size === null || item.unit === null) return "Format habituel à confirmer";
    const target = normalizedSize(item.size, item.unit), source = normalizedSize(p.size, p.unit);
    if (target.unit !== source.unit || Math.abs(target.size - source.size) > .000001) return "Formats de paquets différents";
  }
  if (offerQuantity(item, p) === null) return item.measure === "uses" ? "Dose ou capacité non confirmée" : "Poids ou format du besoin inconnu";
  if (/prix (?:de barquette )?estimé/i.test(p.matchNote ?? "")) return "Prix de paquet estimé";
  return "";
}
/** Presentation only: one unambiguous dated reference per item/mode. Never certifies a basket. */
export function observedSummary(plan: GroceryPlan, retailer: GroceryRetailer, now?: string) {
  let known = 0, priced = 0, food = 0, household = 0;
  const missing: { name: string; reason: string }[] = [];
  for (const item of plan.items.filter(i => i.active)) {
    const offers = currentPrices(plan, item, retailer, now).filter(p => datedPrice(p, now) && p.available !== "no");
    if (offers.length) known++;
    let reason = offers.length > 1 ? "Plusieurs références à distinguer" : quantityReason(item, offers[0]);
    const price = offers[0];
    if (!reason && price && (price.currency !== plan.currency || !price.mode || price.mode === "unknown" || price.mode !== retailer.mode)) reason = "Devise ou mode non comparable";
    if (!reason && price) {
      const cost = Math.round(offerQuantity(item, price)! * price.price * 100);
      if (Number.isSafeInteger(cost)) { priced++; if (item.bucket === "household") household += cost; else food += cost; }
      else reason = "Montant non calculable";
    }
    if (reason) missing.push({ name: item.name, reason });
  }
  return { known, priced, subtotal: priced ? food + household : null, food, household, missing };
}
export function unitPrice(p: GroceryPrice) {
  if (/format (?:non confirmé|à confirmer)/i.test(p.matchNote ?? "")) return "Prix du format observé, taille non confirmée";
  const size = normalizedSize(p.size, p.unit);
  const amount = p.usesPerPack ? p.price / p.usesPerPack : p.price / size.size;
  return `${Number(amount.toFixed(4))} ${p.currency}/${p.usesPerPack ? "utilisation (étiquette)" : size.unit === "each" ? "unité" : size.unit}`;
}
export function equivalentCost(item: ShoppingItem, p: GroceryPrice) {
  const qty = item.basketQuantity !== undefined ? item.basketQuantity : item.quantity;
  if (qty === null || quantityReason(item, p)) return null;
  if (item.measure === "uses") return p.usesPerPack ? qty * p.price / p.usesPerPack : null;
  if (item.measure === "pack") return null; // A usual pack's capacity may differ from this reference.
  if (item.size === null || item.unit === null) return null;
  const target=normalizedSize(item.size,item.unit), source=normalizedSize(p.size,p.unit);
  return target.unit === source.unit ? qty * target.size / source.size * p.price : null;
}
