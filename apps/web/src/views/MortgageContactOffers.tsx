import { useState } from "react";
import { currentAssumptions, mortgageScenario, type MortgageState, type ProductKey, type Quote } from "../../../worker/src/mortgage-model";
import { compareMortgage, latestDecisionProfile, decisionTermsFor } from "../../../worker/src/mortgage-decision";
import { localDate } from "../../../worker/src/mortgage-model";
import type { MortgageContact } from "../../../worker/src/mortgage-contacts";
import { cad, percent, variantLabel, shortDate, appointmentDate } from "../mortgage-display";

const products: ProductKey[] = ["variable-3", "variable-5", "fixed-3", "fixed-5"];
const scenarioName = (key:ProductKey) => (key.startsWith("fixed")?"Fixed ":"Variable ") + (key.endsWith("3")?"3":"5") + " years";
const contactStatus = {active:"Active",appointment:"Appointment scheduled","email-sent":"Email sent","awaiting-response":"Awaiting response",paused:"Paused"};

type Props = {
  contact: MortgageContact; quotes: Quote[]; state: MortgageState;
  initiallyExpanded: boolean; onContact: () => void; onQuote: (id: string) => void; onCompare?: (id?: string) => void;
};
export default function MortgageContactOffers({contact,quotes,state,initiallyExpanded,onContact,onQuote,onCompare}: Props) {
  const [expanded,setExpanded] = useState(initiallyExpanded);
  const [selectedProduct,setSelectedProduct] = useState<ProductKey>("variable-5");
  const [selectedVariant,setSelectedVariant] = useState("");
  const [penalty,setPenalty] = useState(""), [legal,setLegal] = useState(""), [appraisal,setAppraisal] = useState(""), [other,setOther] = useState("");
  const own = quotes.filter(q=>q.contactId===contact.contactId);
  const choices=(product:ProductKey)=>own.filter(q=>q.product===product && q.status!=="historical").sort((a,b)=>b.receivedDate.localeCompare(a.receivedDate)||a.rate-b.rate);
  const selectedOffers=choices(selectedProduct);
  const selected=selectedOffers.find(q=>q.id===selectedVariant) || selectedOffers[0];
  const assumptions=currentAssumptions(state);
  const payment=(q:Quote|undefined) => {
    if (onCompare) { if (!q) return null; const comparison=compareMortgage(latestDecisionProfile(state.profiles??[])??null,q,decisionTermsFor(state.terms??[],q.id)??null,localDate(new Date())); return comparison.replacement?.initialPayment??null; }
    if(!q || !assumptions || q.variant==="fixed-payment" || q.variant==="unconfirmed-payment") return null;
    try {return mortgageScenario(assumptions.principal,q.rate,assumptions.remainingMonths,Math.min(assumptions.remainingMonths,q.product.endsWith("3")?36:60),q.product.startsWith("variable")?"monthly":"semiannual").payment;}
    catch {return null;}
  };
  const costInputs=[penalty,legal,appraisal,other];
  const costsEntered=costInputs.every(v=>v.trim()!=="" && Number.isFinite(Number(v)) && Number(v)>=0);
  const gross=costsEntered?costInputs.reduce((sum,v)=>sum+Number(v),0):null;
  const verifiedCashback=selected?.cashback?.basis==="cashback" ? selected.cashback.amount : null;
  const net=gross!==null && verifiedCashback!==null ? gross-verifiedCashback : null;
  const initials=contact.name.split(/\s+/).slice(0,2).map(part=>part[0]).join("").toLocaleUpperCase("en-CA");
  return <article className="mortgage-contact-panel">
    <button type="button" className="mortgage-contact-card mortgage-contact-panel-head" aria-expanded={expanded} onClick={()=>setExpanded(v=>!v)}>
      <span className="mortgage-contact-initials" aria-hidden="true">{initials}</span>
      <span className="mortgage-contact-name"><b>{contact.name}</b><small>{contact.organization}</small></span>
      <span className={"mortgage-badge status-"+contact.status}>{contactStatus[contact.status]}</span>
      <span aria-hidden="true" className="mortgage-expand-symbol">{expanded?"⌃":"⌄"}</span>
    </button>
    {expanded&&<div className="mortgage-contact-panel-content">
      {contact.appointment&&<p className="mortgage-contact-subnote">Appointment: {appointmentDate(contact.appointment.startsAt)} · Vancouver</p>}
      <div className="mortgage-scenario-grid" role="group" aria-label={"Offers from "+contact.name}>
        {products.map(product=>{
          const offers=choices(product),q=offers[0],historical=own.some(v=>v.product===product && v.status==="historical"),monthly=payment(q),selectedCard=selectedProduct===product;
          return <button type="button" key={product} className={"mortgage-scenario-card"+(selectedCard?" is-selected":"")+(q?"":" is-unavailable")}
            aria-pressed={selectedCard} onClick={()=>{setSelectedProduct(product);setSelectedVariant("");}}
            aria-label={scenarioName(product)+", "+(q?percent(q.rate):"information not received")}>
            <span className="mortgage-scenario-label">{scenarioName(product)}</span>
            <strong>{q?percent(q.rate):"—"}</strong>
            <small>Estimated monthly payment</small>
            <b className="mortgage-monthly">{monthly===null?"—":cad(monthly)}</b>
            <span className={q?.cashback?"mortgage-incentive":"mortgage-scenario-muted"}>{q?.cashback?(q.cashback.basis==="total-incentive"?"Total incentives: ":"Cashback : ")+cad(q.cashback.amount):"Cashback: unknown"}</span>
            {!q&&<span className="mortgage-scenario-notice">{historical?"Historical offer only":"Information not received"}</span>}
            {offers.length>1&&<span className="mortgage-scenario-notice">{offers.length} variants received</span>}
          </button>;
        })}
      </div>
      <section className="mortgage-selected-offer" aria-label={"Summary for "+scenarioName(selectedProduct)}>
        <div className="mortgage-selected-header"><b>{scenarioName(selectedProduct)} · selected scenario</b>{selected?<span className="mortgage-badge">Indicative offer</span>:<span className="mortgage-badge">To confirm</span>}</div>
        {selected?<>
          {selectedOffers.length>1&&<label className="mortgage-variant-picker">Payment structure
            <select value={selected.id} onChange={e=>setSelectedVariant(e.target.value)}>{selectedOffers.map(q=><option key={q.id} value={q.id}>{variantLabel(q)} · {percent(q.rate)} · {shortDate(q.receivedDate)}</option>)}</select>
          </label>}
          <div className="mortgage-selected-numbers">
            <span><small>Offered rate</small><b>{percent(selected.rate)}</b></span>
            <span><small>Estimated monthly payment</small><b>{payment(selected)===null?"—":cad(payment(selected)!)}</b></span>
          </div>
          {payment(selected)===null&&<p className="mortgage-contact-subnote">{onCompare?"Confirm the monthly payment against the dated balance, payment and loan terms.":!assumptions?"Private balance and amortization unavailable.":"Contractual variable-rate payment not confirmed. The monthly payment cannot be calculated."}</p>}
          <div className="mortgage-incentive-details"><b>Additional incentives</b>
            {selected.cashback?<><p>{selected.cashback.basis==="total-incentive"?"Total incentives reported":"Cashback"} : {cad(selected.cashback.amount)}</p>{selected.cashback.conditions.map((condition,i)=><small key={i}>• {condition}</small>)}</>:<p>Amount and terms not received.</p>}
          </div>
          <button type="button" className="mortgage-detail-link" onClick={()=>onQuote(selected.id)}>View this offer’s terms and details ›</button>
        </>:<p className="mortgage-contact-subnote">No current quote saved for this product. Its fields remain visible for easy comparison.</p>}
        {onCompare ? <button type="button" className="mortgage-detail-link" disabled={!selected} onClick={()=>selected&&onCompare(selected.id)}>Compare through my current term’s maturity ›</button> : <details className="mortgage-refinance-estimate"><summary>Refinancing cost estimate</summary>
          <p>This local simulation is not saved. Enter confirmed penalty and fees before estimating the cost.</p>
          <div className="mortgage-refinance-fields">{([["Prepayment penalty",penalty,setPenalty],["Legal fees",legal,setLegal],["Appraisal",appraisal,setAppraisal],["Other fees",other,setOther]] as const).map(([label,value,change])=><label key={label}>{label}<input type="number" min="0" step="0.01" inputMode="decimal" value={value} onChange={e=>change(e.target.value)} placeholder="To confirm" /></label>)}</div>
          <div className="mortgage-refinance-total"><span>Estimated gross cost</span><b>{gross===null?"—":cad(gross)}</b></div>
          <div className="mortgage-refinance-total"><span>Net cost after cashback</span><b>{net===null?"To confirm":cad(net)}</b></div>
          <small>Total incentives are not deducted as cashback. Net cost is unknown without a confirmed cashback amount and all fees.</small>
        </details>}
      </section>
      <div className="mortgage-contact-footer"><span>{contact.status==="awaiting-response"||contact.status==="email-sent"?"Awaiting response":"Confirm terms and penalty"}</span><button type="button" onClick={onContact}>History and conversations ›</button></div>
    </div>}
  </article>;
}
