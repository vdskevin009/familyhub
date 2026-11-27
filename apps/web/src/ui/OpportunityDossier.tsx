import { useEffect, useState } from 'react';
import type { PropertyCard } from '../property-api';
import type { VehicleCard } from '../vehicle-api';
import type { Evidence } from '../../../worker/src/property-model';
import { currentFact, localDay, projectDecision, vehicleAsks } from '../opportunity-analysis';
import { ComparableSales } from './ComparableSales';
import './opportunity-dossier.css';

const money = (n:number) => new Intl.NumberFormat('fr-CA',{style:'currency',currency:'CAD',maximumFractionDigits:2}).format(n);
const names:Record<string,string> = {budget:'Budget', bedrooms:'Chambres', neighbourhood:'Quartier', entrances:'Entrées séparées', suv:'SUV familial', used:'Occasion', area:'Grand Vancouver'};
type Props = {kind:'property';card:PropertyCard} | {kind:'vehicle';card:VehicleCard;pool:VehicleCard[]};

function Citation({fact,label}:{fact:Evidence<unknown>;label:string}) {
  if (!fact.checkedAt || !fact.sourceUrl) return <small>Source à obtenir</small>;
  return <a href={fact.sourceUrl} target="_blank" rel="noreferrer">{label} · <time dateTime={fact.checkedAt}>{localDay(Date.parse(fact.checkedAt))}</time></a>;
}
function PropertyAnalysis({card,at}:{card:PropertyCard;at:number}) {
  const fee = card.monthlyStrataFeeCad;
  return <>
    <h4>Prix face aux ventes</h4>
    <p>Les annonces enregistrées documentent des prix affichés. Pour situer le prix, examinez des ventes conclues.</p>
    <ComparableSales card={card} at={at}/>
    <details><summary>Coût de détention et conditions</summary>
      {fee?.value!=null?<p>Strata documentée à {money(fee.value)}/mois. Sur douze mois au même tarif, {money(fee.value*12)} pour ce poste seul. <Citation fact={fee} label="Source des frais"/></p>:<p>Frais de strata inconnus. Vérifier le régime de propriété et le montant propre au lot.</p>}
      <p>Avant l’offre, examiner le Form B si applicable, les cotisations spéciales, le fonds de réserve, le rapport de dépréciation et l’assurance. Ajouter taxes, financement et travaux pour établir le coût de détention.</p>
      <p>{card.airbnb.status==='prohibited'?'La source indique une restriction de location.':card.airbnb.status==='conditional'?'La location dépend de conditions à vérifier.':'Le droit de louer reste à établir.'} Avant de compter un loyer, vérifier le zonage, la légalité du logement et les règlements de strata. Rendement inconnu sans loyer, vacance et charges documentés.</p>
    </details>
    <p><strong>Avant la visite.</strong> {card.separateEntrances.value===true?'Vérifier sur place les deux accès décrits et demander le plan autorisé.':'Obtenir un plan qui confirme les deux entrées et les pièces habitables.'}</p>
  </>;
}
function VehicleAnalysis({card,pool,at}:{card:VehicleCard;pool:VehicleCard[];at:number}) {
  const peers=vehicleAsks(card,pool,at);
  const identity=[card.year.value,card.make.value,card.model.value,card.trim.value].filter(v=>v!=null);
  return <>
    <h4>Modèle et version</h4><p>{identity.join(' · ') || 'Modèle inconnu'}. {identity.length<4?'Identité technique incomplète.':'Version déclarée dans l’annonce.'} Fiabilité et coûts d’usage à documenter.</p>
    <details><summary>Rappels et coût d’usage</summary>
      <p>Vérifier les problèmes récurrents pour cette année et cette motorisation, puis le statut des réparations avec le NIV. Les rappels ouverts du véhicule restent inconnus.</p>
      <p><a href="https://tc.canada.ca/en/road-transportation/defects-recalls-vehicles-tires-child-car-seats" target="_blank" rel="noreferrer">Recherche de rappels de Transports Canada</a></p>
      <p>Confirmer moteur, transmission et carburant avant de comparer la consommation. Le coût annuel dépend aussi des kilomètres parcourus, du prix de l’énergie, de l’assurance et de l’entretien.</p>
    </details>
    <h4>Cette offre</h4><p>{card.mileageKm.value==null?'Kilométrage inconnu':card.mileageKm.value.toLocaleString('fr-CA')+' km déclarés'}. Prix total avec frais à confirmer.</p>
    <details><summary>Annonces locales de référence ({peers.length})</summary>
      <p>Même marque, modèle, année, version et transmission intégrale ou non, dans le Grand Vancouver. Écart maximal de 10 000 km. Seuls les prix demandés et statuts observés depuis 48 h sont retenus.</p>
      {peers.length?<ul>{peers.map(p=><li key={p.listingId}>{p.title} · {p.mileageKm.value?.toLocaleString('fr-CA')} km · {money(p.priceCad.value!)} avant taxes. <Citation fact={p.priceCad} label="Prix affiché"/></li>)}</ul>:<p>Aucune autre annonce enregistrée ne satisfait ces filtres.</p>}
      <p>Une même voiture peut figurer sur plusieurs sites. Vérifier le NIV, l’état, l’équipement, l’historique et les frais avant de comparer. Prix conclus et valeur de marché inconnus.</p>
    </details>
    <p><strong>Avant l’essai.</strong> {card.accidentHistory.value?'Recouper l’historique déclaré avec le rapport du véhicule.':'Obtenir le rapport d’historique du véhicule.'} Demander le prix total écrit et une inspection indépendante avant engagement.</p>
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
  return <section className="opportunity-dossier" aria-label="Analyse de l’opportunité">
    <p className="decision-date">Analyse du <time dateTime={new Date(at).toISOString()}>{localDay(at)}</time></p>
    <h3>{projectDecision(card,at)}</h3>
    <p>Prix affiché{card.priceCad.value==null?' inconnu':' de '+money(card.priceCad.value)}{props.kind==='vehicle'?' avant taxes':''}. <Citation fact={card.priceCad} label="Prix observé"/></p>
    <details><summary>Motifs du verdict et confiance</summary>
      <ul>{card.criteria.map(c=><li key={c.id}><strong>{names[c.id]}</strong>{c.id==='bedrooms' && c.evidence.value!=null?' · '+String(c.evidence.value):''} · {c.id==='budget'&&!currentFact(card.priceCad,at)?'à reconfirmer':c.pass===null?'à documenter':c.pass?'point favorable':'écart avec le projet'}. <Citation fact={c.evidence} label="Preuve"/></li>)}</ul>
      <p>Le verdict porte sur les critères documentés dans l’annonce. La confiance sur le prix de marché reste limitée. <Citation fact={card.statusEvidence} label="Statut observé"/></p>
    </details>
    {props.kind==='property'?<PropertyAnalysis card={props.card} at={at}/>:<VehicleAnalysis card={props.card} pool={props.pool} at={at}/>}
  </section>;
}
