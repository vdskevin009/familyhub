import type { PurchaseResolution } from "../../../worker/src/grocery-purchase-resolution";
import { scenarioFamily } from "../../../worker/src/grocery-purchase-scenarios";
import { grocerySourceLink } from "../grocery-source-link";
export default function GroceryReferenceLeads({state,product}:{state?:PurchaseResolution;product:string}) {
  const leads=state?.referenceLeads?.filter(l=>l.family===scenarioFamily(product))??[];
  return leads.length ? <section className="grocery-reference-leads" aria-label="Leads excluded from the calculation"><h5>Leads to verify · excluded from the calculation</h5>{leads.map(l=>{const link=grocerySourceLink(l.sourceUrl);return <article key={l.id}><strong>{l.store} · {l.product}</strong><p>{l.reason}</p>{l.indicativePrice!==null&&<p>Unverified index price: {l.indicativePrice.toLocaleString("en-CA",{minimumFractionDigits:2})} CAD. Excluded from the total.</p>}<p>{l.note} · Checked on {l.date}.</p>{link&&<a href={link.href} target="_blank" rel="noreferrer">View lead from {l.store}</a>}</article>;})}</section> : null;
}
