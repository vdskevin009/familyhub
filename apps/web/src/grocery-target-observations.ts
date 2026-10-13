import type { GroceryPlan, GroceryPrice, ShoppingItem } from "../../worker/src/grocery-planning";
import { normalizeProduct } from "../../worker/src/grocery-model";
import { storeGroups, storeName } from "./grocery-comparison";
import { articleUnitComparison, type RankedOffer } from "./grocery-unit-comparison";
import { targetSavings, literalBrand, type TargetSaving } from "./grocery-catalogue";

const words = (value: string) => normalizeProduct(value).normalize("NFKD").replace(/\p{M}/gu, "");
function category(value: string) {
  const rules: [string, RegExp][] = [
    ["coffee", /\b(?:coffee|cafe|espresso|decaf)\b/], ["milk", /\b(?:milk|lait)\b|\bboisson\s+(?:d['’]|de\s+)(?:amande|avoine|soja)/],
    ["yogurt", /\b(?:yogurt|yoghurt|yogourt|yaourt|skyr)\b/], ["eggs", /\b(?:eggs?|oeufs?)\b/],
    ["pasta", /\b(?:pasta|pates|spaghetti|macaroni)\b/], ["laundry", /\b(?:laundry|lessive)\b/],
    ["dishwasher", /\b(?:dishwasher|lave-vaisselle)\b/], ["shampoo", /\b(?:shampoo|shampoing)\b/],
    ["chicken", /\b(?:chicken|poulet)\b/], ["beef", /\b(?:beef|boeuf)\b/], ["tuna", /\b(?:tuna|thon)\b/],
    ["apples", /\b(?:apples?|pommes?)\b/], ["bread", /\b(?:bread|pain)\b/],
  ];
  const matches = rules.filter(([,pattern]) => pattern.test(value)).map(([name]) => name);
  return matches.length === 1 ? matches[0] : null;
}
function coffeeForm(value: string) {
  const kinds = [
    ["instant", /\b(?:instant|instantane|soluble)\b/], ["pods", /\b(?:pods?|capsules?|dosettes?|k-cups?)\b/],
    ["beans", /\bwhole\s+beans?\b|\bcoffee\s+beans?\b|\b(?:en\s+)?grains\b/], ["ground", /\b(?:ground|moulu[es]?)\b/],
  ] as const;
  const found = kinds.filter(([,pattern]) => pattern.test(value));
  return found.length === 1 ? found[0][0] : null;
}
function milkType(value: string) {
  if (/\b(?:almond|amande|oat|avoine|soy|soja|coconut|coco)\b/.test(value)) return "plant";
  if (/\b(?:cow|vache|dairy)\b|\blait\s+(?:entier|ecreme|2\s*%)\b|\b(?:whole|skim)\s+milk\b/.test(value)) return "dairy";
  return null;
}
/** Explicit literal contradictions only. Unknown quality is never silently certified. */
export function targetProductConflict(item: ShoppingItem, baseline: GroceryPrice, alternative: GroceryPrice): string | null {
  const productText=(p:GroceryPrice)=>words(p.product.slice(literalBrand(p.product)?.length??0));
  const base=productText(baseline), alt=productText(alternative), need=words(item.name+" "+item.preference);
  const baseCategory=category(base), altCategory=category(alt), needCategory=category(need);
  if (baseCategory && altCategory && baseCategory !== altCategory) return "Types de produits différents";
  if (needCategory && [baseCategory,altCategory].some(c => c && c !== needCategory)) return "Type différent du produit demandé";
  if ([baseCategory,altCategory,needCategory].includes("coffee")) {
    const b=coffeeForm(base), a=coffeeForm(alt), n=coffeeForm(need);
    if (b && a && b !== a || n && [b,a].some(form=>form && form !== n)) return "Types de café différents";
    const systems = (text: string) => /\bvertuo\b/.test(text) ? "vertuo" : /\b(?:keurig|k-cups?)\b/.test(text) ? "keurig" : /\btassimo\b/.test(text) ? "tassimo" : /\bnespresso\s+original\b/.test(text) ? "nespresso-original" : null;
    const bs=systems(base), as=systems(alt), ns=systems(need);
    if (bs && as && bs !== as || ns && [bs, as].some(system => system && system !== ns)) return "Systèmes de capsules différents";
  }
  if ([baseCategory,altCategory,needCategory].includes("milk")) {
    const b=milkType(base), a=milkType(alt), n=milkType(need);
    if(b && a && b !== a || n && [b,a].some(type=>type && type !== n)) return "Types de lait différents";
  }
  if ([baseCategory,altCategory,needCategory].includes("yogurt")) {
    const type=(text:string)=>/\bskyr\b/.test(text)?"skyr":/\b(?:greek|grec)\b/.test(text)?"greek":null;
    const b=type(base),a=type(alt),n=type(need); if(b && a && b !== a || n && [b,a].some(t=>t && t !== n)) return "Types de yogourt différents";
  }
  const frozen=(text:string)=>/\b(?:frozen|surgele[es]?|congele[es]?)\b/.test(text);
  const fresh=(text:string)=>/\b(?:fresh|frais|fraiche)\b/.test(text.replace(/^your fresh market\b/,""));
  if(frozen(base)&&fresh(alt) || fresh(base)&&frozen(alt) || item.freshness==="fresh" && (frozen(base)||frozen(alt)) || item.freshness==="frozen" && (fresh(base)||fresh(alt))) return "Frais et surgelé non équivalents";
  return null;
}
export type TargetObservation = TargetSaving & { validated: boolean; warnings: string[] };
function verificationWarnings(plan: GroceryPlan, item: ShoppingItem, b: RankedOffer, a: RankedOffer) {
  const warnings: string[]=[];
  if(!b.p.approved || !a.p.approved)warnings.push("Sources non revues");
  if(b.p.substitution || a.p.substitution)warnings.push(item.substitutions ? "Équivalence à vérifier" : "Substitution non autorisée");
  else if(normalizeProduct(b.p.product)!==normalizeProduct(a.p.product))warnings.push("Marque / variante à vérifier");
  if(b.p.mode!==a.p.mode)warnings.push("Modes différents");
  if([b,a].some(o=>o.p.available!=="yes"))warnings.push("Disponibilité à vérifier");
  if(!plan.areaConfirmed || [b,a].some(o=>!o.r.areaConfirmed || !o.p.localityConfirmed || !o.p.locality?.trim() || normalizeProduct(o.p.locality)!==normalizeProduct(o.r.locality??"")))warnings.push("Zone à vérifier");
  if([b,a].some(o=>!o.p.evidence.until))warnings.push("Validité à reconfirmer");
  if([b,a].some(o=>!o.r.otherFeesReviewed || o.r.delivery===null || o.r.service===null || o.r.servicePercent===null || o.p.taxPercent===null || o.p.depositPerPack==null))warnings.push("Frais / taxes à vérifier");
  return warnings;
}
/** Mathematical product-rate leads only. This never approves an offer or asserts equivalent quality,
 * known stock, serviceability, fees, household quantities, or a cheapest complete order.
 */
export function observedTargetOpportunities(plan: GroceryPlan, items: ShoppingItem[], now=new Date().toISOString().slice(0,10)) {
  const groups=storeGroups(plan);
  const validated=targetSavings(plan,items,now).result.filter(s=>!targetProductConflict(s.item,s.baseline.p,s.alternative.p));
  const result: TargetObservation[]=validated.map(s=>({...s,validated:true,warnings:[]}));
  const excluded: {item: ShoppingItem; reasons: string[]}[]=[];
  for(const item of items){
    const offers=articleUnitComparison(plan,item,groups,now).rows.flatMap(row=>row.offers);
    const references=offers.filter(o=>storeName(o.r.name)==="Superstore" && !o.reason && o.rate && o.rate.amount>0);
    const reasons=new Set<string>();
    if(!references.length)reasons.add("Référence Superstore manquante ou non calculable");
    for(const group of groups.filter(g=>g.name!=="Superstore")){
      if(result.some(s=>s.item.id===item.id && storeName(s.alternative.r.name)===group.name))continue;
      const candidates: TargetObservation[]=[];
      for(const alternative of offers.filter(o=>group.retailers.some(r=>r.id===o.r.id))){
        if(alternative.reason || !alternative.rate){reasons.add(alternative.reason || "Format non calculable");continue;}
        const sameUnit=references.filter(b=>b.rate!.basis===alternative.rate!.basis && b.p.currency===alternative.p.currency);
        if(references.length && !sameUnit.length)reasons.add("Unités non compatibles");
        const compatible=sameUnit.filter(b=>{const conflict=targetProductConflict(item,b.p,alternative.p);if(conflict)reasons.add(conflict);return !conflict;});
        // Prefer the same known mode, then use its lowest unit reference conservatively.
        const sameMode=compatible.filter(b=>b.p.mode===alternative.p.mode), pool=sameMode.length?sameMode:compatible;
        const baseline=[...pool].sort((a,b)=>a.rate!.amount-b.rate!.amount)[0];
        if(!baseline)continue;
        const difference=baseline.rate!.amount-alternative.rate.amount;
        if(difference<=Number.EPSILON*Math.max(baseline.rate!.amount,alternative.rate.amount)*8){reasons.add("Aucun prix unitaire plus bas observé");continue;}
        const percent=difference/baseline.rate!.amount*100;
        if(!Number.isFinite(percent)||percent<=0)continue;
        candidates.push({item,alternative,baseline,percent,difference,validated:false,warnings:verificationWarnings(plan,item,baseline,alternative)});
      }
      candidates.sort((a,b)=>Number(a.baseline.p.mode!==a.alternative.p.mode)-Number(b.baseline.p.mode!==b.alternative.p.mode)||b.percent-a.percent);
      if(candidates[0])result.push(candidates[0]);
    }
    if(!result.some(row=>row.item.id===item.id))excluded.push({item,reasons:reasons.size?[...reasons]:["Prix alternatif manquant"]});
  }
  return {result,excluded,validatedCount:result.filter(s=>s.validated).length,observedCount:result.filter(s=>!s.validated).length};
}
