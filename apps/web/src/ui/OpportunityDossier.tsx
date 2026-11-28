import { useEffect, useState } from 'react';
import type { PropertyCard } from '../property-api';
import type { VehicleCard } from '../vehicle-api';
import type { Evidence } from '../../../worker/src/property-model';
import { currentFact, localDay, projectDecision, vehicleAsks } from '../opportunity-analysis';
import { ComparableSales } from './ComparableSales';
import { ListingPhoto } from './ListingPhoto';
import './opportunity-dossier.css';

const money = (n:number) => new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD',maximumFractionDigits:2}).format(n);
const names:Record<string,string> = {budget:'Budget', bedrooms:'Bedrooms', neighbourhood:'Neighbourhood', entrances:'Separate entrances', suv:'Family SUV', used:'Used', area:'Metro Vancouver'};
type Props = {kind:'property';card:PropertyCard} | {kind:'vehicle';card:VehicleCard;pool:VehicleCard[]};

function Citation({fact,label}:{fact:Evidence<unknown>;label:string}) {
  if (!fact.checkedAt || !fact.sourceUrl) return <small>Source needed</small>;
  return <a href={fact.sourceUrl} target="_blank" rel="noreferrer">{label} · <time dateTime={fact.checkedAt}>{localDay(Date.parse(fact.checkedAt))}</time></a>;
}
function PropertyAnalysis({card,at}:{card:PropertyCard;at:number}) {
  const fee = card.monthlyStrataFeeCad;
  return <>
    <h4>Asking price vs. closed sales</h4>
    <p>Saved listings show asking prices. Use completed sales to assess the asking price.</p>
    <ComparableSales card={card} at={at}/>
    <details><summary>Ownership costs and conditions</summary>
      {fee?.value!=null?<p>Documented strata fees: {money(fee.value)}/month. Over twelve months at that rate, {money(fee.value*12)} for this item alone. <Citation fact={fee} label="Fee source"/></p>:<p>Strata fees unknown. Confirm the tenure and fees for this lot.</p>}
      <p>Before making an offer, check Form B if applicable, special levies, the contingency reserve, the depreciation report and insurance. Include taxes, financing and repairs in ownership costs.</p>
      <p>{card.airbnb.status==='prohibited'?'The source notes a rental restriction.':card.airbnb.status==='conditional'?'Rental is subject to conditions that need checking.':'Permission to rent is not established.'} Before counting rental income, check zoning, suite legality and strata bylaws. Without documented rent, vacancy and expenses, the return is unknown.</p>
    </details>
    <p><strong>Before the viewing.</strong> {card.separateEntrances.value===true?'Check the two entrances in person and request the approved floor plan.':'Get a plan that confirms both entrances and habitable rooms.'}</p>
  </>;
}
function VehicleAnalysis({card,pool,at}:{card:VehicleCard;pool:VehicleCard[];at:number}) {
  const peers=vehicleAsks(card,pool,at);
  const identity=[card.year.value,card.make.value,card.model.value,card.trim.value].filter(v=>v!=null);
  return <>
    <h4>Model and trim</h4><p>{identity.join(' · ') || 'Model unknown'}. {identity.length<4?'Technical details incomplete.':'Trim as stated in the listing.'} Reliability and running costs need evidence.</p>
    <details><summary>Recalls and running costs</summary>
      <p>Check recurring issues for this model year and engine, then use the VIN to verify repairs. Open recalls for this vehicle are unknown.</p>
      <p><a href="https://tc.canada.ca/en/road-transportation/defects-recalls-vehicles-tires-child-car-seats" target="_blank" rel="noreferrer">Transport Canada recall search</a></p>
      <p>Confirm engine, transmission and fuel before comparing consumption. Annual costs also depend on distance driven, energy prices, insurance and maintenance.</p>
    </details>
    <h4>This listing</h4><p>{card.mileageKm.value==null?'Mileage unknown':card.mileageKm.value.toLocaleString('en-CA')+' km reported'}. Confirm the all-in price including fees.</p>
    <details><summary>Local comparison listings ({peers.length})</summary>
      <p>Same make, model, year, trim and all-wheel-drive configuration in Metro Vancouver. Maximum mileage difference of 10,000 km. Only asking prices and listing statuses observed within 48 hours are included.</p>
      {peers.length?<ul>{peers.map(p=><li key={p.listingId}>{p.title} · {p.mileageKm.value?.toLocaleString('en-CA')} km · {money(p.priceCad.value!)} before tax. <Citation fact={p.priceCad} label="Asking price"/></li>)}</ul>:<p>No other saved listings match these filters.</p>}
      <p>The same vehicle can appear on multiple sites. Check the VIN, condition, equipment, history and fees. Final sale prices and market value are unknown.</p>
    </details>
    <p><strong>Before the test drive.</strong> {card.accidentHistory.value?'Cross-check the stated history against the vehicle history report.':'Get the vehicle history report.'} Ask for a written all-in price and an independent inspection before committing.</p>
  </>;
}
export function OpportunityDossier(props:Props) {
  const {card}=props;
  const [at,setAt]=useState(Date.now);
  useEffect(()=>{
    const refresh=()=>setAt(Date.now());
    const timer=window.setInterval(refresh,30_000);
    window.addEventListener('focus',refresh);
    return ()=>{clearInterval(timer);window.removeEventListener('focus',refresh);};
  },[]);
  return <section className="opportunity-dossier" aria-label="Opportunity analysis">
    <p className="decision-date">Analysis date: <time dateTime={new Date(at).toISOString()}>{localDay(at)}</time></p>
    <h3>{projectDecision(card,at)}</h3>
    <p>Asking price{card.priceCad.value==null?' unknown':' of '+money(card.priceCad.value)}{props.kind==='vehicle'?' before tax':''}. <Citation fact={card.priceCad} label="Observed price"/></p>
    <ListingPhoto key={card.primaryPhoto?.url} photo={card.primaryPhoto}
      label={props.kind === 'property' ? props.card.address : props.card.title}/>
    <details><summary>Reasons and confidence</summary>
      <ul>{card.criteria.map(c=><li key={c.id}><strong>{names[c.id]}</strong>{c.id==='bedrooms' && c.evidence.value!=null?' · '+String(c.evidence.value):''} · {c.id==='budget'&&!currentFact(card.priceCad,at)?'to reconfirm':c.pass===null?'needs evidence':c.pass?'strength':'does not match the project'}. <Citation fact={c.evidence} label="Evidence"/></li>)}</ul>
      <p>The assessment covers only the criteria documented in the listing. Confidence in market pricing remains limited. <Citation fact={card.statusEvidence} label="Observed status"/></p>
    </details>
    {props.kind==='property'?<PropertyAnalysis card={props.card} at={at}/>:<VehicleAnalysis card={props.card} pool={props.pool} at={at}/>}
  </section>;
}
