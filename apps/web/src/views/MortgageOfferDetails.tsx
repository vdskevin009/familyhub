import { useState } from "react";
import { currentAssumptions, negotiatedEstimate, type MortgageState, type Quote } from "../../../worker/src/mortgage-model";
import { percent, productLabel, variantLabel, shortDate, cashbackLabel } from "../mortgage-display";
import { QuoteIllustration } from "./MortgageIllustration";
export default function MortgageOfferDetails({quote:q,state,today,onCompare}:{quote:Quote;state:MortgageState;today:string;onCompare?:()=>void}) {
  const [estimate,setEstimate]=useState(false),scenario=negotiatedEstimate(state,today,q);
  return <div className="mortgage-offer-details view-stack"><div className="mortgage-offer-tile"><strong>{percent(q.rate)}</strong><div><b>{productLabel(q.product)}</b><small>{variantLabel(q)}</small></div><p>{cashbackLabel(q)}</p></div><p>{q.lender} · {shortDate(q.receivedDate)} · {q.status==="historical"?"historical":"indicative, needs reconfirmation"}</p>
    <details open><summary>Conditions</summary><ul>{q.limitations.map((s,i)=><li key={i}>{s}</li>)}{q.cashback?.conditions.map((s,i)=><li key={"cash-"+i}>{s}</li>)}</ul><p>Incentives are specific to this option. Confirm fees, payment structure and eligibility.</p></details>
    {onCompare?<button type="button" onClick={onCompare}>Compare through my current term’s maturity</button>:<><details><summary>Compare this offer with the current rate</summary><QuoteIllustration rate={q.rate} quote={q} assumptions={currentAssumptions(state)}/></details>
    <details><summary>Negotiation scenario</summary><label className="mortgage-toggle"><input type="checkbox" checked={estimate} onChange={e=>setEstimate(e.target.checked)}/>Show negotiation estimate</label>{estimate&&<section aria-label="Negotiation estimate"><p>Today’s public rate + (received offer − public rate on {state.baselineDate}). This keeps the offer-specific difference in percentage points constant. Dates, terms and eligibility may differ. This scenario is not an offer.</p><strong>{scenario?percent(scenario.rate):"Unavailable"}</strong>{scenario&&<><p>Difference {scenario.spread>=0?"+":""}{scenario.spread.toFixed(2)} pt</p><QuoteIllustration rate={scenario.rate} quote={q} assumptions={currentAssumptions(state)}/></>}</section>}</details></>}
    <details><summary>Sources</summary><p>{q.source}</p><p>Offer received on {q.receivedDate}. It is not updated with public rates.</p></details>
  </div>;
}
