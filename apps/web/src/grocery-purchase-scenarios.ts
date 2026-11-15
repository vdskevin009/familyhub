import type { GroceryRecord } from "../../worker/src/grocery-model";
import type { GroceryPlan } from "../../worker/src/grocery-planning";
import type { PurchaseResolution } from "../../worker/src/grocery-purchase-resolution";
import type { PurchaseScenario } from "../../worker/src/grocery-purchase-scenario-model";
import { derivePurchaseScenarios, scenarioStore, scenarioLineDiagnostics, scenarioPriceContext, scenarioReferenceReason, scenarioWithdrawn } from "../../worker/src/grocery-purchase-scenarios";
import { wholeScenarioPacks } from "../../worker/src/grocery-scenario-evidence";
import { estimatedSourceLine } from "../../worker/src/grocery-purchase-evidence";
import { purchaseScenarioRetailers } from "../../worker/src/grocery-purchase-retailers";
import { purchaseLocalDate, purchaseComparison, purchaseStoreComparisons, type PurchaseLineComparison } from "./grocery-purchases";

export type ScenarioLineComparison = PurchaseLineComparison & { confidence: "verified" | "estimated" | "missing"; scenario?: PurchaseScenario; diagnostic?: ReturnType<typeof scenarioLineDiagnostics> };
/** Achats-only projection. Every selected store uses one locality/channel and a common target. */
export function purchaseScenarioStores(plan: GroceryPlan, record: GroceryRecord, today = purchaseLocalDate(), resolution?: PurchaseResolution, records = [record]) {
  const strict = purchaseComparison(plan,record,today,resolution);
  const templates = purchaseStoreComparisons(plan,record,today,resolution,purchaseScenarioRetailers);
  const scenarios = derivePurchaseScenarios([record],plan,resolution,today,10000,records,true);
  const active = record.status === "saved" && !record.duplicateOf;
  return templates.map(store => {
    const candidates = strict.filter(c => scenarioStore(c.retailer.name) === store.name);
    const estimates = scenarios.filter(s => scenarioStore(plan.retailers.find(r => r.id === plan.prices.find(p => p.id === s.priceId)?.retailerId)?.name ?? "") === store.name);
    const contexts = new Set(estimates.map(s => scenarioPriceContext(plan.prices.find(p => p.id === s.priceId)!)));
    for (const c of candidates) for (const l of c.lines) if (l.normalized !== null && l.price) contexts.add(scenarioPriceContext(l.price));
    const forContext = (context: string): ScenarioLineComparison[] => store.lines.map((base,index) => {
      const diagnostic = scenarioLineDiagnostics(plan,record,index,resolution,store.name,today,records);
      const missing: ScenarioLineComparison = { ...base, price:null, normalized:null, outlay:null, packs:null, ratio:null, confidence:"missing", reason:diagnostic.message, diagnostic };
      if (!active || scenarioWithdrawn(resolution,record,index)) return missing;
      const verified = candidates.map(c => c.lines[index]).find(l => l.normalized !== null && l.price && scenarioPriceContext(l.price) === context
        && !scenarioReferenceReason(l.price,plan,record,index,today,records,false));
      if (verified) return {...verified, confidence:verified.comparisonEvidence || verified.formatEvidence?.formatBasis === "household-assumption" ? "estimated" : "verified"};
      const scenario = estimates.find(s => s.lineIndex === index && scenarioPriceContext(plan.prices.find(p => p.id === s.priceId)!) === context);
      if (!scenario) return estimates.some(s => s.lineIndex === index) ? {...missing,diagnostic:{...diagnostic,reasons:["context-mismatch"]},reason:"Référence disponible dans une autre localité ou un autre canal ; elle n’est pas additionnée à ce panier."} : missing;
      const price = plan.prices.find(p => p.id === scenario.priceId)!;
      return {...base,price,reason:"",confidence:"estimated",scenario,normalized:scenario.normalized,outlay:scenario.outlay,packs:scenario.packs,ratio:scenario.ratio,calculated:Math.abs(scenario.ratio-Math.round(scenario.ratio))>1e-10};
    });
    const options = [...contexts].map(context => ({context,lines:forContext(context)}));
    options.sort((a,b) => b.lines.filter(l => l.normalized !== null).length - a.lines.filter(l => l.normalized !== null).length
      || b.lines.filter(l => l.confidence === "verified").length - a.lines.filter(l => l.confidence === "verified").length
      || a.context.localeCompare(b.context));
    const lines = options[0]?.lines ?? forContext("");
    const covered = lines.filter(l => l.normalized !== null), verified = covered.filter(l => l.confidence === "verified").length, estimated = covered.length - verified;
    const matchedSource = lines.map((line,index) => line.normalized === null ? null : estimatedSourceLine(plan.sourceEstimates,record,index)?.amount ?? line.sourceEstimate ?? (record.receipt.sourceType === "final-receipt" ? line.line.amount : null));
    const sourceKnown = matchedSource.filter((amount): amount is number => typeof amount === "number" && Number.isFinite(amount) && amount >= 0);
    const groups = new Map<string,{amount:number;size:number|null;price:number|null;weighed:boolean}>();
    for (const line of covered) {
      const s=line.scenario,p=line.price!,size=s?s.packSize:p.size,price=s?s.packPrice:p.price;
      const key=JSON.stringify([p.id,s?.referenceUnit??p.unit,size,price]),old=groups.get(key);
      groups.set(key,{amount:(old?.amount??0)+line.ratio!*(s?.referenceSize??p.size),size,price,weighed:!s&&p.weighed});
    }
    const outlayKnown=covered.length>0&&[...groups.values()].every(g=>g.size!==null&&g.price!==null);
    const outlay=outlayKnown?[...groups.values()].reduce((n,g)=>n+(g.weighed?g.amount/g.size!:wholeScenarioPacks(g.amount/g.size!))*g.price!,0):null;
    const nonlocal=covered.some(l=>!l.price!.localityConfirmed||!plan.retailers.find(r=>r.id===l.price!.retailerId)?.areaConfirmed||l.price!.locality!==plan.retailers.find(r=>r.id===l.price!.retailerId)?.locality);
    return {...store,retailer:covered.length ? plan.retailers.find(r=>r.id===covered[0].price!.retailerId)! : store.retailer,lines,covered:covered.length,count:lines.length,verified,estimated,complete:lines.length>0&&covered.length===lines.length,
      normalized:covered.length?Math.round(covered.reduce((n,l)=>n+l.normalized!,0)*100)/100:null,outlay:outlay===null?null:Math.round(outlay*100)/100,
      packEstimated:covered.some(l=>l.scenario?.packEstimated),sourceEstimate:covered.length>0&&sourceKnown.length===covered.length?Math.round(sourceKnown.reduce((sum,amount)=>sum+amount,0)*100)/100:null,
      missing:lines.length-covered.length,missingProducts:lines.filter(l=>l.normalized===null).map(l=>l.line.product||l.line.name),observationDates:[...new Set(covered.map(l=>l.price!.evidence.date))].sort(),nonlocal,multiContext:false,
      historical:covered.some(l=>l.scenario&&(l.scenario.ageDays>7||l.price?.kind==="receipt"||!!l.price?.evidence.until&&l.price.evidence.until<today)),limited:covered.some(l=>(l.scenario?.limits.length??0)>0)};
  });
}
