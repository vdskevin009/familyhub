import { normalizeProduct, type GroceryRecord, type GroceryUnit } from "./grocery-model.js";
import { normalizedSize, type GroceryPlan, type GroceryPrice } from "./grocery-planning.js";
import { purchaseEvidenceReason, purchaseLineKey, purchasePriceKey } from "./grocery-purchase-evidence.js";
import { confirmedPurchaseFormat, purchaseCandidateReason, type PurchaseResolution } from "./grocery-purchase-resolution.js";
import type { PurchaseScenario, PurchaseScenarioHint } from "./grocery-purchase-scenario-model.js";
import { purchaseRetailerName, purchaseScenarioRetailers } from "./grocery-purchase-retailers.js";
import { explicitScenarioFormat, independentReceiptPrice, scenarioProductSource, wholeScenarioPacks } from "./grocery-scenario-evidence.js";

const clean = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[’']/g, " ");
export const scenarioStore = purchaseRetailerName;
export const scenarioPriceContext = (p: GroceryPrice) => JSON.stringify([p.retailerId, p.locality ?? "", p.mode ?? "unknown"]);
/** Bounded product families, not a generic fuzzy matcher. No cross-category cheapest substitution. */
export function scenarioFamily(value: string): string {
  const s = clean(value);
  const rows: [string, RegExp][] = [
    ["cheddar-sliced", /(?:cheddar|marble).*(?:slic|tranch)|(?:slic|tranch).*cheddar/],
    ["butter-salted", /\bsalted butter\b|\bbutter salted\b|beurre sale/],
    ["lasagne-dry", /lasagn[ae].*(?:pasta|noodles)|(?:pasta|noodles).*lasagn[ae]/],
    ["mini-cucumber", /mini\s*cucumb|mini.?concombr/], ["english-cucumber", /english cucumber|cucumber english|concombre anglais/],
    ["tofu-extra-firm", /tofu.*(?:extra.?firm|extra.?ferme)|(?:extra.?firm|extra.?ferme).*tofu/], ["honey-nut-cheerios", /(?:honey nut.*cheerio|cheerio.*honey nut)/],
    ["protein-tortilla", /(?:protein.*(?:tortilla|wrap)|(?:tortilla|wrap).*protein)/],
    ["chicken-breast", /(?:boneless.*skinless.*(?:breast|poitrine)|poitrine.*(?:sans peau|desossee))/],
    ["eggs", /\beggs?\b|\boeufs?\b/], ["almond-unsweetened", /(?:almond|amande).*(?:unsweetened|sans sucre)|(?:unsweetened|sans sucre).*(?:almond|amande)/],
    ["greek-plain", /(?:greek|grec).*(?:plain|nature)|(?:plain|nature).*(?:greek|grec)/], ["skyr-plain", /(?:skyr).*(?:plain|nature)|(?:plain|nature).*skyr/],
    ["frozen-four-berry", /(?:4|four)[- ]?berr.*(?:blend|mix)|frozen 4-berry/],
    ["baby-mum-mum", /(?:baby\s*)?mum[- ]mum/], ["gerber-crunchies", /(?:gerber|lil).*crunchies/],
    ["strawberries", /strawberr|fraises?/], ["pasta-wheat", /spaghetti|orzo pasta|pasta orzo|pates.*(?:spaghetti|orzo)/],
    ["coffee-beans", /(?:coffee|cafe).*(?:whole bean|en grains)|(?:whole bean|en grains).*(?:coffee|cafe|espresso)|lavazza.*(?:grains|rossa)/],
    ["english-muffin", /english muffin/], ["salmon", /salmon|saumon/], ["spinach-baby", /baby spinach|epinard.*bebe/]
  ];
  if (/cooked|roasted|seasoned|cajun|breaded|rotisserie|nugget|chocolate|dried/i.test(s) && /chicken|strawberr/.test(s)) return "";
  const family = rows.find(([, r]) => r.test(s))?.[0] ?? "";
  if (family === "strawberries" && /snack|puff|yogurt|yoghurt|juice|jam|jelly|flavou?r|cereal|candy|syrup|bar\b/.test(s)) return "";
  return family;
}
function compatible(a: string, b: string) {
  const x = clean(a), y = clean(b), family = scenarioFamily(x);
  // Exact text outside the substitution families is still an estimate, never SKU proof.
  if (normalizeProduct(a) && normalizeProduct(a) === normalizeProduct(b)) return true;
  if (!family || family !== scenarioFamily(y)) return false;
  // Explicit dietary/production constraints never disappear under an estimated label.
  for (const r of [/gluten[- ]?free|sans gluten/, /lactose[- ]?free|sans lactose/, /organic|organics|biologique|\bbio\b/, /free[- ]range|plein air/, /unsweetened|sans sucre/, /vegan|vegetalien/, /decaf|decaffein/]) if (r.test(x) && !r.test(y)) return false;
  if (["greek-plain", "skyr-plain"].includes(family)) {
    const fat = /\b(\d+(?:[.,]\d+)?)\s*%/.exec(x)?.[1]?.replace(",", ".");
    const referenceFat = /\b(\d+(?:[.,]\d+)?)\s*%/.exec(y)?.[1]?.replace(",", ".");
    if (fat !== undefined && (referenceFat === undefined || Number(fat) !== Number(referenceFat))) return false;
  }
  if (family === "eggs") {
    const subtype = (s: string) => /substitute|substitut/.test(s) ? "substitute" : /egg whites?|blancs d/.test(s) ? "whites" : /liquid|liquide/.test(s) ? "liquid-whole" : "shell";
    if (subtype(x) !== subtype(y)) return false;
    for (const r of [/free[- ]run|liberte/, /omega[- ]?3/, /\blarge\b|\bgros\b/, /\bmedium\b|\bmoyen/]) if (r.test(x) && !r.test(y)) return false;
  }
  if (family === "salmon") {
    for (const r of [/sockeye|rouge/, /atlantic|atlantique/, /\bwild\b|sauvage/, /skinless|sans peau/, /boneless|sans arete/]) if (r.test(x) && !r.test(y)) return false;
  }
  if (family === "chicken-breast" && /frozen|surgele/.test(x) !== /frozen|surgele/.test(y)) return false;
  for (const r of [/frozen|surgele/, /smoked|fume/, /canned|en conserve/, /plant[- ]based|vegetal|vegan/, /whole[- ](?:wheat|grain)|ble entier/, /reduced sodium|less sodium|low sodium|moins de sodium/]) if (r.test(x) !== r.test(y)) return false;
  for (const r of [/grass[- ]fed/, /without antibiotics|sans antibiotiques/]) if (r.test(x) && !r.test(y)) return false;
  if (family === "cheddar-sliced") {
    for (const r of [/\bmarble\b|marbre/, /\bmedium\b|mi[- ]fort/, /\baged\b|vieilli/, /processed|fondu/]) if (r.test(x) !== r.test(y)) return false;
  }
  if (family === "butter-salted" && /peanut|almond|plant|vegan|garlic|herb|spread|canola/.test(y)) return false;
  if (family === "lasagne-dry" && /oven[- ]ready|express|precooked|fresh|frozen|sauce|meat|beef|chicken/.test(x + " " + y)) return false;
  return true;
}
export function scenarioWithdrawn(state: PurchaseResolution | undefined, record: GroceryRecord, index: number) {
  return !!state?.candidates.some(c => c.recordId === record.id && c.lineIndex === index && c.lineKey === purchaseLineKey(record.receipt.items[index]) && state.decisions[c.id]?.state === "unconfirmed");
}
type Format = { size: number; unit: GroceryUnit; note: string; source: { title: string; url: string; date: string } | null };
export type ScenarioBlocker = "retailer-disabled" | "constraints" | "currency" | "missing-price" | "invalid-date" | "stale-price" | "source-unverified" | "receipt-not-independent" | "format-missing" | "withdrawn" | "family-unrecognized" | "no-reference" | "context-mismatch" | "purchase-inactive";
const blockerText: Record<ScenarioBlocker, string> = {
  "context-mismatch": "The reference price is for a different location or purchase channel. It is excluded from this basket.",
  "purchase-inactive": "Unsaved or duplicate purchase: comparison excluded.",
  "retailer-disabled": "Store missing or excluded from comparison.",
  constraints: "The references do not match the source item’s type, quality or dietary requirements.",
  currency: "The currency differs from the purchase currency.",
  "missing-price": "Reference price or pack size missing or invalid. Zero is not assumed.",
  "invalid-date": "Price date missing, invalid or in the future.",
  "stale-price": "Price is too old for this scenario (more than 90 days).",
  "source-unverified": "No dated product listing. A search or category page is only a lead.",
  "receipt-not-independent": "No separate, unambiguous final receipt supports this price.",
  "format-missing": "Not enough quantity or unit evidence for comparison. No conversion of weight, volume or count is assumed.",
  withdrawn: "Confirmation removed. Automatic estimates are paused for this line.",
  "family-unrecognized": "Product family unknown and no reference has the same name. Document equivalence before comparing.",
  "no-reference": "No documented store price for this item or product family."
};
export function scenarioReferenceReason(p: GroceryPrice, plan: GroceryPlan, record: GroceryRecord, index: number, today: string, records: GroceryRecord[], checkCompatibility = true): ScenarioBlocker | null {
  const retailer = plan.retailers.find(r => r.id === p.retailerId), title = record.receipt.items[index].product || record.receipt.items[index].name;
  if (!retailer || retailer.enabled === false) return "retailer-disabled";
  if (checkCompatibility && !compatible(title, p.product)) return "constraints";
  if (p.currency !== record.receipt.currency) return "currency";
  if (typeof p.price !== "number" || !Number.isFinite(p.price) || p.price < 0 || !Number.isFinite(p.size) || p.size <= 0 || !["g","kg","l","ml","each"].includes(p.unit)) return "missing-price";
  const age = (Date.parse(today) - Date.parse(p.evidence.date)) / 86400000;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.evidence.date) || !Number.isFinite(age) || age < 0 || new Date(p.evidence.date).toISOString().slice(0,10) !== p.evidence.date) return "invalid-date";
  if (age > 90) return "stale-price";
  if (p.kind === "public") return p.evidence.title.trim() && scenarioProductSource(p.evidence.url) ? null : "source-unverified";
  if (p.kind === "receipt") return independentReceiptPrice(p,record,records) ? null : "receipt-not-independent";
  return "source-unverified";
}
function reference(p: GroceryPrice, hints: PurchaseScenarioHint[]) {
  const bound = hints.filter(h => h.priceId === p.id && h.priceKey === purchasePriceKey(p));
  for (const purpose of ["reference-format", "reference-pack"]) {
    if (new Set(bound.filter(h => h.purpose === purpose).map(h => JSON.stringify([normalizedSize(h.size,h.unit),h.packagePrice]))).size > 1) return null;
  }
  let size = p.size, unit = p.unit, price = p.price, packSize: number | null = p.weighed ? null : p.size, packPrice: number | null = p.weighed ? null : p.price, packEstimated = false;
  const notes: string[] = [], note = p.matchNote ?? "";
  const format = hints.find(h => h.purpose === "reference-format" && h.priceId === p.id && h.priceKey === purchasePriceKey(p));
  if (format) {
    size = format.size; unit = format.unit; packSize = size; packPrice = p.price; packEstimated = true;
    notes.push("Reference pack size inferred, not confirmed directly by this listing: " + format.note);
  }
  const hint = hints.find(h => h.purpose === "reference-pack" && h.priceId === p.id && h.priceKey === purchasePriceKey(p));
  if (hint) {
    const a = normalizedSize(hint.size, hint.unit), b = normalizedSize(size, unit);
    if (a.unit !== b.unit) return null;
    packSize = a.size / b.size * size; packPrice = hint.packagePrice ?? packSize / size * price; packEstimated = true; notes.push(hint.note);
  } else if (!format && /format (?:non confirme|a confirmer)/.test(clean(note))) {
    const inferred = /([\d.]+)\s*(kg|g|ml|l)\s+seulement inf/i.exec(clean(note));
    if (!inferred) return null;
    size = Number(inferred[1]); unit = inferred[2] as GroceryUnit; packSize = size; packPrice = price; packEstimated = true; notes.push("Reference pack size estimated from the source note: " + inferred[0] + ".");
  } else if (p.weighed) {
    const average = /barquette moyenne\s+(?:environ\s+)?([\d.,]+)\s*(kg|g)/i.exec(note);
    if (average) { const a = normalizedSize(Number(average[1].replace(",", ".")), average[2].toLowerCase() as GroceryUnit), b = normalizedSize(size, unit); if (a.unit === b.unit) { packSize = a.size / b.size * size; packPrice = packSize / size * price; packEstimated = true; notes.push("The source’s estimated average tray weight was retained. The calculation uses the base price without discounts."); } }
  }
  if (/prix de barquette estime/.test(clean(note)) && unit === "each") return null; // no implicit count-to-mass conversion
  return { size, unit, price, packSize, packPrice, packEstimated, notes };
}
function inferredFormat(record: GroceryRecord, index: number, plan: GroceryPlan, state: PurchaseResolution | undefined, refs: GroceryPrice[], now: number, sourceRecords: GroceryRecord[]): Format | null {
  const line = record.receipt.items[index], title = line.product || line.name;
  const confirmed = confirmedPurchaseFormat(state, record, index);
  const scoped = state?.candidates.filter(c => c.recordId === record.id && c.lineIndex === index && !purchaseCandidateReason(c, record, now) && c.size !== null && c.unit !== null) ?? [];
  const selected = confirmed ?? (scoped.length === 1 ? scoped[0] : undefined);
  if (selected) return { size: selected.size!, unit: selected.unit!, note: confirmed && selected.formatBasis === "public-source" ? "Pack size confirmed for this purchase." : "Assumed pack size for this line: " + selected.formatLabel + ". " + selected.note, source: { title: selected.note, url: selected.sourceUrl, date: selected.observedAt } };
  if (line.size !== null && line.unit) return { size: line.size, unit: line.unit, note: "Format transcrit dans la source d'achat.", source: null };
  const explicit = explicitScenarioFormat(title);
  if (explicit) return { ...explicit, note: "Pack size stated in the source description: " + title, source: null };
  const reviewed = (plan.purchaseComparisons ?? []).filter(e => e.recordId === record.id && e.lineIndex === index && e.lineKey === purchaseLineKey(line) && Date.parse(e.reviewedAt) <= now && !purchaseEvidenceReason(e,record,plan));
  if (reviewed.length && reviewed.every(e => e.size === reviewed[0].size && e.unit === reviewed[0].unit)) return { size: reviewed[0].size, unit: reviewed[0].unit, note: "Pack size derived from retained comparison evidence: " + reviewed[0].provenance, source: { title: reviewed[0].provenance, url: "", date: reviewed[0].reviewedAt } };
  const validSource = (c: NonNullable<PurchaseResolution["candidates"]>[number]) => state?.decisions[c.id]?.state !== "unconfirmed" && sourceRecords.some(r=>r.id===c.recordId&&!purchaseCandidateReason(c,r,now));
  const sameId = state?.candidates.filter(c => c.size !== null && c.unit !== null && c.productId === line.productReference?.id && validSource(c)) ?? [];
  const named = state?.candidates.filter(c => c.size !== null && c.unit !== null && c.formatBasis === "public-source" && state.decisions[c.id]?.state === "confirmed" && normalizeProduct(c.product) === normalizeProduct(title) && validSource(c)) ?? [];
  const sourceHints = state?.scenarioHints?.filter(h => h.purpose === "source-format" && Date.parse(h.observedAt) <= now && (line.productReference ? h.productId === line.productReference.id : !h.productId && normalizeProduct(h.product) === normalizeProduct(title))) ?? [];
  if (new Set(sourceHints.map(h => JSON.stringify(normalizedSize(h.size,h.unit)))).size > 1) return null;
  const hint = sourceHints[0];
  if (hint) return { size: hint.size, unit: hint.unit, note: "Illustrative pack size. The purchased item’s identity remains unverified: " + hint.note, source: { title: hint.note, url: hint.sourceUrl, date: hint.observedAt } };
  const reusable = sameId.length ? sameId : named;
  if (reusable.length && reusable.every(c => c.size === reusable[0].size && c.unit === reusable[0].unit)) { const c = reusable[0]; return { size: c.size!, unit: c.unit!, note: "Pack size assumed from other evidence. This does not confirm the purchased item’s identity: " + c.formatLabel + ".", source: { title: c.note, url: c.sourceUrl, date: c.observedAt } }; }
  // An explicitly large/multiple source pack cannot silently become one competitor pack.
  // A source-bound candidate or hint above is required before normalizing this quantity.
  if (/\bclub\b|family[- ]?size|format familial|\d+\s*(?:pk|packs?|[- ]packs?)\b|\d+\s*[x×]\s*\d+|packs?\s+of\s+\d+/i.test(title)) return null;
  // A source pack is a scenario unit, never evidence of the historical quantity.
  const formats = refs.map(p => ({ p, r: reference(p, state?.scenarioHints ?? []) })).filter(x => x.r && !x.p.weighed)
    .sort((a,b) => Number(normalizeProduct(b.p.product)===normalizeProduct(title))-Number(normalizeProduct(a.p.product)===normalizeProduct(title)) || Number(/\b(?:club|\d+\s*[×x])\b/i.test(a.p.product)) - Number(/\b(?:club|\d+\s*[×x])\b/i.test(b.p.product)) || a.p.evidence.date.localeCompare(b.p.evidence.date) * -1 || normalizedSize(a.r!.size,a.r!.unit).size - normalizedSize(b.r!.size,b.r!.unit).size || a.p.id.localeCompare(b.p.id));
  const best = formats[0];
  if (best) return { size: best.r!.size, unit: best.r!.unit, note: `Purchased pack size unknown: assumes a source pack of ${best.r!.size} ${best.r!.unit}, based on the reference pack size for ${best.p.product}.`, source: { title: best.p.evidence.title, url: best.p.evidence.url, date: best.p.evidence.date } };
  const weighted = refs.slice().sort((a,b)=>b.evidence.date.localeCompare(a.evidence.date)||a.id.localeCompare(b.id)).map(p => ({p,r:reference(p,state?.scenarioHints??[])})).find(x=>x.r?.packSize);
  return weighted?.r ? { size: weighted.r.packSize!, unit: weighted.r.unit, note: "Purchased pack size unknown: assumes one tray at the reference’s estimated average weight.", source: { title: weighted.p.evidence.title, url: weighted.p.evidence.url, date: weighted.p.evidence.date } } : null;
}
/** Pure scenario projection; never consumed by shopping recommendations or certain-savings alerts. */
export function derivePurchaseScenarios(records: GroceryRecord[], plan: GroceryPlan, state: PurchaseResolution | undefined, today: string, maximum = 1000, referenceRecords = records, allContexts = false): PurchaseScenario[] {
  const now = Date.parse(today + "T23:59:59.999Z"), result: PurchaseScenario[] = [];
  // Filter hints once so future observations cannot change an earlier calculation.
  state = state && { ...state, scenarioHints: state.scenarioHints?.filter(h => Date.parse(h.observedAt) <= now) };
  for (const record of records.filter(r => !r.duplicateOf && r.status === "saved").slice().sort((a,b)=>(b.receipt.fulfillment?.date||b.receipt.date||b.createdAt).localeCompare(a.receipt.fulfillment?.date||a.receipt.date||a.createdAt))) {
    const recordStart = result.length;
    for (const [lineIndex,line] of record.receipt.items.entries()) {
      // The limit applies after context selection, never midway through a line.
      if (scenarioWithdrawn(state,record,lineIndex)) continue;
      const title = line.product || line.name, family = scenarioFamily(title) || "exact-name";
      const refs = plan.prices.filter(p => !scenarioReferenceReason(p, plan, record, lineIndex, today, referenceRecords));
      let target = inferredFormat(record,lineIndex,plan,state,refs,now,referenceRecords); if (!target) continue;
      // An uncertain selling unit has no physical definition. Choose ONE reference package
      // across all retailers before calculating anything, never one different package per store.
      if (target.unit === "each" && target.size === 1 && line.uncertain && line.unit === null) {
        const physicalRefs = refs.filter(p => reference(p, state?.scenarioHints ?? [])?.unit !== "each");
        const inferred = inferredFormat({ ...record, receipt: { ...record.receipt, items: record.receipt.items.map((l,i) => i === lineIndex ? { ...l, size:null, unit:null } : l) } },lineIndex,{...plan,purchaseComparisons:[]},undefined,physicalRefs,now,[]);
        if (inferred && inferred.unit !== "each") target = { ...inferred, note: "Physical sales unit unknown. The same assumption applies to all stores. " + inferred.note };
      }
      const countBases = (state?.scenarioHints ?? []).filter(h => h.purpose === "count-equivalent" && target.unit === "each" && h.sourceCount === target.size && Date.parse(h.observedAt) <= now && (line.productReference ? h.productId === line.productReference.id : !h.productId && normalizeProduct(h.product) === normalizeProduct(title)) && plan.prices.some(p => p.id === h.priceId && purchasePriceKey(p) === h.priceKey));
      if (new Set(countBases.map(h => JSON.stringify(normalizedSize(h.size,h.unit)))).size > 1) continue;
      const countBasis = countBases[0];
      const targetForPacks = normalizedSize(countBasis?.size ?? target.size, countBasis?.unit ?? target.unit);
      const packDistance = (p: GroceryPrice) => { const r=reference(p,state?.scenarioHints??[]); if(!r)return Infinity;const n=normalizedSize(r.packSize??r.size,r.unit);return n.unit===targetForPacks.unit?Math.abs(Math.log(n.size/targetForPacks.size)):Infinity; };
      for (const store of purchaseScenarioRetailers) {
        const pool = refs.filter(p=>scenarioStore(plan.retailers.find(r=>r.id===p.retailerId)!.name)===store)
          .sort((a,b)=>b.evidence.date.localeCompare(a.evidence.date) || Number(!!b.localityConfirmed)-Number(!!a.localityConfirmed) || Number(normalizeProduct(b.product)===normalizeProduct(title))-Number(normalizeProduct(a.product)===normalizeProduct(title)) || packDistance(a)-packDistance(b) || a.id.localeCompare(b.id));
        const seenContexts = new Set<string>();
        for (const price of pool) {
          const context = scenarioPriceContext(price); if (seenContexts.has(context)) continue;
          const ref=reference(price,state?.scenarioHints??[]); if (!ref) continue;
          if (price.kind === "receipt") {
            const original = independentReceiptPrice(price, record, referenceRecords)?.line;
            if (!original) continue;
            const originalQuantity = original.quantity ?? 1;
            ref.price /= originalQuantity; if (ref.packPrice !== null) ref.packPrice /= originalQuantity; if (original.quantity === null) ref.packEstimated = true;
            ref.notes.push(original.quantity === null ? "Estimated reference unit price: the historical receipt does not give a pack count, so the amount is treated as the price of one pack." : `Historical receipt amount divided by its ${originalQuantity} pack(s).`);
          }
          const assumptions=[target.note,...ref.notes], limits:string[]=[], quantity=line.quantity??1;
          if (line.quantity===null) assumptions.push("Purchased quantity unknown. Assumes one source pack.");
          let targetSize=target.size,targetUnit=target.unit;
          const a=normalizedSize(targetSize,targetUnit);
          if (countBasis && a.unit === "each") {
            targetSize=countBasis.size;targetUnit=countBasis.unit;
            assumptions.push("Common quantity assumption: " + countBasis.sourceCount + "  units =" + countBasis.size + " " + countBasis.unit + " in this scenario. Actual weight unknown. " + countBasis.note);
          }
          const x=normalizedSize(quantity*targetSize,targetUnit), y=normalizedSize(ref.size,ref.unit); if(x.unit!==y.unit)continue;
          const ratio=x.size/y.size,normalized=ratio*ref.price;
          const targetInRef=x.size/y.size*ref.size, packs=ref.packSize===null?null:wholeScenarioPacks(targetInRef/ref.packSize),outlay=packs===null||ref.packPrice===null?null:packs*ref.packPrice;
          if (![ratio,normalized].every(Number.isFinite)||ratio<=0||normalized>1_000_000||outlay!==null&&(!Number.isFinite(outlay)||outlay>1_000_000))continue;
          const retailer=plan.retailers.find(r=>r.id===price.retailerId)!, ageDays=Math.floor((Date.parse(today)-Date.parse(price.evidence.date))/86400000);
          if(!price.mode || price.mode === "unknown" || price.mode !== retailer.mode) limits.push("Purchase channel unknown or different from the store’s channel. Price scenario only.");
          if(ageDays>7||price.kind==="receipt"||price.evidence.until&&price.evidence.until<today)limits.push(`Historical price: observed on ${price.evidence.date}, ${ageDays} days ago. No current offer is guaranteed.`);
          if(!price.localityConfirmed||!retailer.areaConfirmed||price.locality!==retailer.locality||/catalogue par défaut/i.test(retailer.name)||price.kind==="receipt")limits.push(`Non-local reference or service area not verified: ${price.locality||retailer.locality||"unknown location"}.`);
          if(price.available!=="yes")limits.push(price.available==="no"?"Unavailable according to the source. Price scenario only.":"Availability not confirmed.");
          if(store==="Costco"&&retailer.membershipStatus!=="existing")limits.push("Check Costco membership and terms.");
          if(/promo|loyal|coupon|remise|BASE.*avant/i.test(price.matchNote??""))limits.push("Check historical promotional or regular pricing terms. No additional discount was applied.");
          const relation=normalizeProduct(price.product)===normalizeProduct(title)?"estimated-match":"estimated-substitution";
          if(relation==="estimated-substitution")assumptions.push(`Estimated substitution: ${price.product}. Type and documented requirements are retained. Brand, variant and nutritional values may differ.`);
          const sourceReceipt=price.kind==="receipt"?independentReceiptPrice(price,record,referenceRecords)?.source.id??null:null;
          const sourceUnit=normalizedSize(targetSize,targetUnit),formula=`${quantity} × ${Number(sourceUnit.size.toFixed(6))} ${sourceUnit.unit} ÷ (${Number(y.size.toFixed(6))} ${y.unit}) × ${Number(ref.price.toFixed(6))} ${price.currency} = ${normalized.toFixed(2)} ${price.currency} prorated.`;
          const formatSources=[...(target.source?[target.source]:[]),...(countBasis?[{title:countBasis.note,url:countBasis.sourceUrl,date:countBasis.observedAt}]:[]),...((state?.scenarioHints??[]).filter(h=>["reference-pack","reference-format"].includes(h.purpose)&&h.priceId===price.id&&h.priceKey===purchasePriceKey(price)).map(h=>({title:h.note,url:h.sourceUrl,date:h.observedAt})))].map(s=>({...s,title:s.title.slice(0,500)}));
          result.push({recordId:record.id,lineIndex,lineKey:purchaseLineKey(line),priceId:price.id,priceKey:purchasePriceKey(price),family,relation,quantity,size:targetSize,unit:targetUnit,referenceSize:ref.size,referenceUnit:ref.unit,referencePrice:ref.price,packSize:ref.packSize,packPrice:ref.packPrice,packEstimated:ref.packEstimated,normalized,outlay,packs,ratio,assumptions,limits,formula,ageDays,formatSources,sourceReceiptId:sourceReceipt}); seenContexts.add(context);
        }
      }
    }
    const options = result.splice(recordStart);
    result.push(...(allContexts ? options : selectScenarioContexts(options,plan)));
    if (result.length >= maximum) return result.slice(0,maximum);
  }
  return result;
}

function selectScenarioContexts(result: PurchaseScenario[], plan: GroceryPlan): PurchaseScenario[] {
  const byStore = new Map<string, Map<string, PurchaseScenario[]>>();
  for (const row of result) {
    const price = plan.prices.find(p => p.id === row.priceId)!;
    const store = scenarioStore(plan.retailers.find(r => r.id === price.retailerId)!.name);
    const key = JSON.stringify([row.recordId,store]), context = scenarioPriceContext(price);
    const contexts = byStore.get(key) ?? new Map<string, PurchaseScenario[]>();
    contexts.set(context,[...(contexts.get(context) ?? []),row]); byStore.set(key,contexts);
  }
  const selected = new Set<PurchaseScenario>();
  for (const contexts of byStore.values()) {
    const best = [...contexts.entries()].sort(([a,x],[b,y]) => y.length-x.length || a.localeCompare(b))[0];
    for (const row of best[1]) selected.add(row);
  }
  return result.filter(row => selected.has(row));
}

/** Structured local diagnosis. It never sends purchase data to a research service. */
export function scenarioLineDiagnostics(plan: GroceryPlan, record: GroceryRecord, index: number, state: PurchaseResolution | undefined, store: string, today: string, records = [record]) {
  const line = record.receipt.items[index], name = line.product || line.name, family = scenarioFamily(name);
  const refs = plan.prices.filter(p => scenarioStore(plan.retailers.find(r => r.id === p.retailerId)?.name ?? "") === store && (normalizeProduct(p.product) === normalizeProduct(name) || family && scenarioFamily(p.product) === family));
  const candidates = refs.map(p => ({ priceId:p.id, reason:scenarioReferenceReason(p,plan,record,index,today,records) }));
  const reasons: ScenarioBlocker[] = record.status !== "saved" || record.duplicateOf ? ["purchase-inactive"] : scenarioWithdrawn(state,record,index) ? ["withdrawn"] : !refs.length ? [family ? "no-reference" : "family-unrecognized"] : candidates.some(c => !c.reason) ? ["format-missing"] : [...new Set(candidates.map(c => c.reason!))];
  return { recordId:record.id, lineIndex:index, store, family:family || null, candidates, reasons, message:reasons.map(r => blockerText[r]).join(" ") };
}
export function scenarioUnavailableReason(plan: GroceryPlan, record: GroceryRecord, index: number, state: PurchaseResolution | undefined, store: string, today: string, records = [record]) {
  return scenarioLineDiagnostics(plan,record,index,state,store,today,records).message;
}
