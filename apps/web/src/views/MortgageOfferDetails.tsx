import { useState } from "react";
import { currentAssumptions, negotiatedEstimate, type MortgageState, type Quote } from "../../../worker/src/mortgage-model";
import { percent, productLabel, variantLabel, shortDate, cashbackLabel } from "../mortgage-display";
import { QuoteIllustration } from "./MortgageIllustration";
export default function MortgageOfferDetails({quote:q,state,today}:{quote:Quote;state:MortgageState;today:string}) {
  const [estimate,setEstimate]=useState(false),scenario=negotiatedEstimate(state,today,q);
  return <div className="mortgage-offer-details view-stack"><div className="mortgage-offer-tile"><strong>{percent(q.rate)}</strong><div><b>{productLabel(q.product)}</b><small>{variantLabel(q)}</small></div><p>{cashbackLabel(q)}</p></div><p>{q.lender} · {shortDate(q.receivedDate)} · {q.status==="historical"?"ancien":"indicatif, à reconfirmer"}</p>
    <details open><summary>Conditions</summary><ul>{q.limitations.map((s,i)=><li key={i}>{s}</li>)}{q.cashback?.conditions.map((s,i)=><li key={"cash-"+i}>{s}</li>)}</ul><p>Remises propres à cette option. Frais, structure des paiements et admissibilité à vérifier.</p></details>
    <details><summary>Comparer cette offre au taux actuel</summary><QuoteIllustration rate={q.rate} quote={q} assumptions={currentAssumptions(state)}/></details>
    <details><summary>Scénario de négociation</summary><label className="mortgage-toggle"><input type="checkbox" checked={estimate} onChange={e=>setEstimate(e.target.checked)}/>Afficher l’estimation de négociation</label>{estimate&&<section aria-label="Estimation de négociation"><p>Taux public du jour + (offre reçue − taux public du {state.baselineDate}). Écart constant propre à cette offre, en points ; dates, conditions et admissibilité peuvent différer. Ce scénario n’est pas une offre.</p><strong>{scenario?percent(scenario.rate):"Indisponible"}</strong>{scenario&&<><p>Écart {scenario.spread>=0?"+":""}{scenario.spread.toFixed(2)} pt</p><QuoteIllustration rate={scenario.rate} quote={q} assumptions={currentAssumptions(state)}/></>}</section>}</details>
    <details><summary>Sources</summary><p>{q.source}</p><p>Offre reçue le {q.receivedDate}. Elle n’est pas actualisée avec les taux publics.</p></details>
  </div>;
}
