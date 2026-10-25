import { useState } from "react";
import { currentAssumptions, mortgageScenario, type MortgageState, type ProductKey, type Quote } from "../../../worker/src/mortgage-model";
import type { MortgageContact } from "../../../worker/src/mortgage-contacts";
import { cad, percent, productLabel, variantLabel, shortDate, appointmentDate } from "../mortgage-display";

const products: ProductKey[] = ["variable-3", "variable-5", "fixed-3", "fixed-5"];
const contactStatus = {active:"Actif",appointment:"RDV prévu","email-sent":"Mail envoyé","awaiting-response":"Réponse attendue",paused:"En pause"};

type Props = {
  contact: MortgageContact; quotes: Quote[]; state: MortgageState;
  initiallyExpanded: boolean; onContact: () => void; onQuote: (id: string) => void;
};
export default function MortgageContactOffers({contact,quotes,state,initiallyExpanded,onContact,onQuote}: Props) {
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
    if(!q || !assumptions || q.variant==="fixed-payment" || q.variant==="unconfirmed-payment") return null;
    try {return mortgageScenario(assumptions.principal,q.rate,assumptions.remainingMonths,Math.min(assumptions.remainingMonths,q.product.endsWith("3")?36:60),q.product.startsWith("variable")?"monthly":"semiannual").payment;}
    catch {return null;}
  };
  const costInputs=[penalty,legal,appraisal,other];
  const costsEntered=costInputs.every(v=>v.trim()!=="" && Number.isFinite(Number(v)) && Number(v)>=0);
  const gross=costsEntered?costInputs.reduce((sum,v)=>sum+Number(v),0):null;
  const verifiedCashback=selected?.cashback?.basis==="cashback" ? selected.cashback.amount : null;
  const net=gross!==null && verifiedCashback!==null ? gross-verifiedCashback : null;
  const initials=contact.name.split(/\s+/).slice(0,2).map(part=>part[0]).join("").toLocaleUpperCase("fr-CA");
  return <article className="mortgage-contact-panel">
    <button type="button" className="mortgage-contact-card mortgage-contact-panel-head" aria-expanded={expanded} onClick={()=>setExpanded(v=>!v)}>
      <span className="mortgage-contact-initials" aria-hidden="true">{initials}</span>
      <span className="mortgage-contact-name"><b>{contact.name}</b><small>{contact.organization}</small></span>
      <span className={"mortgage-badge status-"+contact.status}>{contactStatus[contact.status]}</span>
      <span aria-hidden="true" className="mortgage-expand-symbol">{expanded?"⌃":"⌄"}</span>
    </button>
    {expanded&&<div className="mortgage-contact-panel-content">
      {contact.appointment&&<p className="mortgage-contact-subnote">RDV : {appointmentDate(contact.appointment.startsAt)} · Vancouver</p>}
      <div className="mortgage-scenario-grid" role="group" aria-label={"Offres de "+contact.name}>
        {products.map(product=>{
          const offers=choices(product),q=offers[0],historical=own.some(v=>v.product===product && v.status==="historical"),monthly=payment(q),selectedCard=selectedProduct===product;
          return <button type="button" key={product} className={"mortgage-scenario-card"+(selectedCard?" is-selected":"")+(q?"":" is-unavailable")}
            aria-pressed={selectedCard} onClick={()=>{setSelectedProduct(product);setSelectedVariant("");}}
            aria-label={productLabel(product)+", "+(q?percent(q.rate):"information non reçue")}>
            <span className="mortgage-scenario-label">{productLabel(product)}</span>
            <strong>{q?percent(q.rate):"—"}</strong>
            <small>Mensualité estimée</small>
            <b className="mortgage-monthly">{monthly===null?"—":cad(monthly)}</b>
            <span className={q?.cashback?"mortgage-incentive":"mortgage-scenario-muted"}>{q?.cashback?(q.cashback.basis==="total-incentive"?"Avantages totaux : ":"Cashback : ")+cad(q.cashback.amount):"Cashback : inconnu"}</span>
            {!q&&<span className="mortgage-scenario-notice">{historical?"Ancienne offre uniquement":"Information non reçue"}</span>}
            {offers.length>1&&<span className="mortgage-scenario-notice">{offers.length} variantes reçues</span>}
          </button>;
        })}
      </div>
      <section className="mortgage-selected-offer" aria-label={"Résumé de "+productLabel(selectedProduct)}>
        <div className="mortgage-selected-header"><b>{productLabel(selectedProduct)} · scénario sélectionné</b>{selected?<span className="mortgage-badge">Offre indicative</span>:<span className="mortgage-badge">À confirmer</span>}</div>
        {selected?<>
          {selectedOffers.length>1&&<label className="mortgage-variant-picker">Structure des paiements
            <select value={selected.id} onChange={e=>setSelectedVariant(e.target.value)}>{selectedOffers.map(q=><option key={q.id} value={q.id}>{variantLabel(q)} · {percent(q.rate)} · {shortDate(q.receivedDate)}</option>)}</select>
          </label>}
          <div className="mortgage-selected-numbers">
            <span><small>Taux proposé</small><b>{percent(selected.rate)}</b></span>
            <span><small>Mensualité estimée</small><b>{payment(selected)===null?"—":cad(payment(selected)!)}</b></span>
          </div>
          {payment(selected)===null&&<p className="mortgage-contact-subnote">{!assumptions?"Solde et amortissement privés non disponibles.":"Paiement contractuel variable non confirmé : mensualité non calculable."}</p>}
          <div className="mortgage-incentive-details"><b>Remises supplémentaires</b>
            {selected.cashback?<><p>{selected.cashback.basis==="total-incentive"?"Avantages totaux déclarés":"Cashback"} : {cad(selected.cashback.amount)}</p>{selected.cashback.conditions.map((condition,i)=><small key={i}>• {condition}</small>)}</>:<p>Montant et conditions non reçus.</p>}
          </div>
          <button type="button" className="mortgage-detail-link" onClick={()=>onQuote(selected.id)}>Conditions et détails de cette offre ›</button>
        </>:<p className="mortgage-contact-subnote">Aucune proposition actuelle enregistrée pour ce produit. Les champs restent visibles pour faciliter la comparaison.</p>}
        <details className="mortgage-refinance-estimate"><summary>Estimation du coût de refinancement</summary>
          <p>Simulation locale non sauvegardée. Renseigner la pénalité et les frais confirmés avant d’estimer le coût.</p>
          <div className="mortgage-refinance-fields">{([["Pénalité de remboursement",penalty,setPenalty],["Frais juridiques",legal,setLegal],["Évaluation",appraisal,setAppraisal],["Autres frais",other,setOther]] as const).map(([label,value,change])=><label key={label}>{label}<input type="number" min="0" step="0.01" inputMode="decimal" value={value} onChange={e=>change(e.target.value)} placeholder="À confirmer" /></label>)}</div>
          <div className="mortgage-refinance-total"><span>Coût brut estimé</span><b>{gross===null?"—":cad(gross)}</b></div>
          <div className="mortgage-refinance-total"><span>Coût net après cashback</span><b>{net===null?"À confirmer":cad(net)}</b></div>
          <small>Les avantages « totaux » ne sont pas déduits comme du cashback. Le coût net reste inconnu sans montant de cashback confirmé et tous les frais.</small>
        </details>
      </section>
      <div className="mortgage-contact-footer"><span>{contact.status==="awaiting-response"||contact.status==="email-sent"?"Réponse attendue":"Conditions et pénalité à confirmer"}</span><button type="button" onClick={onContact}>Historique et échanges ›</button></div>
    </div>}
  </article>;
}
