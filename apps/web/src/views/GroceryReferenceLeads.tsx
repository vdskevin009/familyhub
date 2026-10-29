import type { PurchaseResolution } from "../../../worker/src/grocery-purchase-resolution";
import { scenarioFamily } from "../../../worker/src/grocery-purchase-scenarios";
import { grocerySourceLink } from "../grocery-source-link";
export default function GroceryReferenceLeads({state,product}:{state?:PurchaseResolution;product:string}) {
  const leads=state?.referenceLeads?.filter(l=>l.family===scenarioFamily(product))??[];
  return leads.length ? <section className="grocery-reference-leads" aria-label="Pistes hors calcul"><h5>Pistes à vérifier · hors calcul</h5>{leads.map(l=>{const link=grocerySourceLink(l.sourceUrl);return <article key={l.id}><strong>{l.store} · {l.product}</strong><p>{l.reason}</p>{l.indicativePrice!==null&&<p>Prix d’index non vérifié : {l.indicativePrice.toLocaleString("fr-CA",{minimumFractionDigits:2})} CAD. Exclu du total.</p>}<p>{l.note} · Lecture du {l.date}.</p>{link&&<a href={link.href} target="_blank" rel="noreferrer">Examiner la piste {l.store}</a>}</article>;})}</section> : null;
}
