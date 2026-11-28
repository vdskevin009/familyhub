import type { GroceryPrice } from "../../../worker/src/grocery-planning";
import type { PurchaseScenario } from "../../../worker/src/grocery-purchase-scenario-model";
import { grocerySourceLink } from "../grocery-source-link";
import { normalizedSize } from "../../../worker/src/grocery-planning";
const money=(n:number,currency:string)=>new Intl.NumberFormat("en-CA",{style:"currency",currency}).format(n);
export default function GroceryPurchaseScenario({scenario,price,store,onSourceReceipt}:{scenario:PurchaseScenario;price:GroceryPrice;store:string;onSourceReceipt:(id:string)=>void}){
  const link=grocerySourceLink(price.evidence.url);
  const base=normalizedSize(scenario.referenceSize,scenario.referenceUnit),unitRate=scenario.referencePrice/base.size;
  return <section className="grocery-purchase-evidence grocery-scenario-evidence" aria-label="Assumptions and estimated calculation">
    <h5>{store}</h5><p><strong>{scenario.relation==="estimated-substitution"?"Estimated substitution":"Estimated comparison"}</strong> — illustrative scenario, not an offer or guaranteed saving.</p>
    <p>{price.product} · {money(scenario.referencePrice,price.currency)} / {scenario.referenceSize} {scenario.referenceUnit}. Price observed on {price.evidence.date} ({scenario.ageDays} day(s)), {price.locality||"location not verified"}.</p>
    <p>Normalised rate: {Number(unitRate.toFixed(4)).toLocaleString("en-CA",{maximumFractionDigits:4})} {price.currency}/{base.unit === "each" ? "unit" : base.unit}.</p>
    {price.matchNote && <p>{price.matchNote}</p>}
    <ul>{scenario.assumptions.map((s,i)=><li key={i}>{s}</li>)}</ul>
    <p className="grocery-scenario-formula">{scenario.formula}</p>
    <p>{scenario.packs===null||scenario.outlay===null?"Whole-pack cost unavailable because the actual weight or pack size is unknown.":`${scenario.packs} whole pack(s) ${scenario.packEstimated?price.weighed?"using the estimated average weight":"using estimated pack size or quantity":"needed in this scenario"} × ${money(scenario.packPrice!,price.currency)} = ${money(scenario.outlay,price.currency)}.`} {scenario.packEstimated&&price.weighed&&"The actual number of trays and final amount depend on the exact weights."}</p>
    {scenario.limits.length>0&&<ul className="grocery-scenario-limits">{scenario.limits.map((s,i)=><li key={i}>{s}</li>)}</ul>}
    <p>Items only. Excludes taxes, deposits, fees, membership and travel. This calculation doesn’t authorise any substitutions in the basket.</p>
    {link&&<p><a href={link.href} target="_blank" rel="noreferrer">View the source price</a></p>}
    {scenario.sourceReceiptId&&<button type="button" className="text-action" onClick={()=>onSourceReceipt(scenario.sourceReceiptId!)}>View the receipt for the historical price</button>}
    {scenario.formatSources.map((s,i)=>{const source=grocerySourceLink(s.url);return <p key={i}>Pack size evidence ({s.date}) : {s.title} {source&&<a href={source.href} target="_blank" rel="noreferrer">View pack size evidence</a>}</p>;})}
  </section>;
}
