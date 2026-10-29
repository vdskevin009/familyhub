import type { GroceryRecord } from "../../worker/src/grocery-model";
import type { GroceryPlan } from "../../worker/src/grocery-planning";
import type { PurchaseResolution } from "../../worker/src/grocery-purchase-resolution";
import type { PurchaseScenario } from "../../worker/src/grocery-purchase-scenario-model";
import { derivePurchaseScenarios, scenarioStore, scenarioUnavailableReason } from "../../worker/src/grocery-purchase-scenarios";
import { purchaseLocalDate, purchaseStoreComparisons, type PurchaseLineComparison } from "./grocery-purchases";

export type ScenarioLineComparison = PurchaseLineComparison & { confidence: "verified" | "estimated" | "missing"; scenario?: PurchaseScenario };
/** Achats-only view. The verified comparator used by other modules is deliberately unchanged. */
export function purchaseScenarioStores(plan: GroceryPlan, record: GroceryRecord, today = purchaseLocalDate(), resolution?: PurchaseResolution, records = [record]) {
  const strict=purchaseStoreComparisons(plan,record,today,resolution),scenarios=derivePurchaseScenarios([record],plan,resolution,today,500,records);
  return strict.map(store=>{
    const lines:ScenarioLineComparison[]=store.lines.map((line,index)=>{
      if(line.normalized!==null)return {...line,confidence:line.comparisonEvidence||line.formatEvidence?.formatBasis==="household-assumption"?"estimated":"verified"};
      const scenario=scenarios.find(s=>s.lineIndex===index&&scenarioStore(plan.retailers.find(r=>r.id===plan.prices.find(p=>p.id===s.priceId)?.retailerId)?.name??"")===store.name);
      if(!scenario)return {...line,confidence:"missing",reason:scenarioUnavailableReason(plan,record,index,resolution,store.name,today)};
      const price=plan.prices.find(p=>p.id===scenario.priceId)!;
      return {...line,price,reason:"",confidence:"estimated",scenario,normalized:scenario.normalized,outlay:scenario.outlay,packs:scenario.packs,ratio:scenario.ratio,calculated:Math.abs(scenario.ratio-Math.round(scenario.ratio))>1e-10};
    });
    const covered=lines.filter(l=>l.normalized!==null),verified=covered.filter(l=>l.confidence==="verified").length,estimated=covered.length-verified;
    const groups=new Map<string,{amount:number;size:number|null;price:number|null;weighed:boolean}>();
    for(const line of covered){
      const s=line.scenario,p=line.price!,size=s?s.packSize:p.size,price=s?s.packPrice:p.price;
      const key=JSON.stringify([p.id,s?.referenceUnit??p.unit,size,price]);const old=groups.get(key);
      groups.set(key,{amount:(old?.amount??0)+line.ratio!*(s?.referenceSize??p.size),size,price,weighed:!s&&p.weighed});
    }
    const outlayKnown=covered.length>0&&[...groups.values()].every(g=>g.size!==null&&g.price!==null);
    const outlay=outlayKnown?[...groups.values()].reduce((n,g)=>n+(g.weighed?g.amount/g.size!:Math.ceil(g.amount/g.size!-1e-10))*g.price!,0):null;
    return {...store,lines,covered:covered.length,count:lines.length,verified,estimated,complete:lines.length>0&&covered.length===lines.length,normalized:covered.length?Math.round(covered.reduce((n,l)=>n+l.normalized!,0)*100)/100:null,outlay:outlay===null?null:Math.round(outlay*100)/100,packEstimated:covered.some(l=>l.scenario?.packEstimated),sourceEstimate:estimated?null:store.sourceEstimate,
      historical:covered.some(l=>l.scenario&&l.scenario.ageDays>7),limited:covered.some(l=>(l.scenario?.limits.length??0)>0)};
  });
}
