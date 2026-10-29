import type { GroceryPrice } from "../../../worker/src/grocery-planning";
import type { PurchaseScenario } from "../../../worker/src/grocery-purchase-scenario-model";
import { grocerySourceLink } from "../grocery-source-link";
import { normalizedSize } from "../../../worker/src/grocery-planning";
const money=(n:number,currency:string)=>new Intl.NumberFormat("fr-CA",{style:"currency",currency}).format(n);
export default function GroceryPurchaseScenario({scenario,price,store,onSourceReceipt}:{scenario:PurchaseScenario;price:GroceryPrice;store:string;onSourceReceipt:(id:string)=>void}){
  const link=grocerySourceLink(price.evidence.url);
  const base=normalizedSize(scenario.referenceSize,scenario.referenceUnit),unitRate=scenario.referencePrice/base.size;
  return <section className="grocery-purchase-evidence grocery-scenario-evidence" aria-label="Hypothèses et calcul estimatif">
    <h5>{store}</h5><p><strong>{scenario.relation==="estimated-substitution"?"Substitution estimée":"Comparaison estimée"}</strong> — référence pour un scénario, pas une offre ni une économie certaine.</p>
    <p>{price.product} · {money(scenario.referencePrice,price.currency)} / {scenario.referenceSize} {scenario.referenceUnit}. Prix observé le {price.evidence.date} ({scenario.ageDays} jour(s)), {price.locality||"localité non vérifiée"}.</p>
    <p>Tarif normalisé : {Number(unitRate.toFixed(4)).toLocaleString("fr-CA",{maximumFractionDigits:4})} {price.currency}/{base.unit === "each" ? "unité" : base.unit}.</p>
    {price.matchNote && <p>{price.matchNote}</p>}
    <ul>{scenario.assumptions.map((s,i)=><li key={i}>{s}</li>)}</ul>
    <p className="grocery-scenario-formula">{scenario.formula}</p>
    <p>{scenario.packs===null||scenario.outlay===null?"Coût des paquets entiers indisponible : poids/conditionnement réel manquant.":`${scenario.packs} paquet(s) entier(s) ${scenario.packEstimated?price.weighed?"dans l'exemple au poids moyen estimé":"dans l'exemple de format/quantité estimés":"nécessaires dans ce scénario"} × ${money(scenario.packPrice!,price.currency)} = ${money(scenario.outlay,price.currency)}.`} {scenario.packEstimated&&price.weighed&&"Le nombre réel de barquettes et le montant final dépendent de leurs poids exacts."}</p>
    {scenario.limits.length>0&&<ul className="grocery-scenario-limits">{scenario.limits.map((s,i)=><li key={i}>{s}</li>)}</ul>}
    <p>Produits seuls : hors taxes, consignes, frais, adhésion et déplacement. Aucun remplacement du panier n'est autorisé par ce calcul.</p>
    {link&&<p><a href={link.href} target="_blank" rel="noreferrer">Examiner le prix source</a></p>}
    {scenario.sourceReceiptId&&<button type="button" className="text-action" onClick={()=>onSourceReceipt(scenario.sourceReceiptId!)}>Consulter le ticket du prix historique</button>}
    {scenario.formatSources.map((s,i)=>{const source=grocerySourceLink(s.url);return <p key={i}>Base de format ({s.date}) : {s.title} {source&&<a href={source.href} target="_blank" rel="noreferrer">Voir la preuve de format</a>}</p>;})}
  </section>;
}
