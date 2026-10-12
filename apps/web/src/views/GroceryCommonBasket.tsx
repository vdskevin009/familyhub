import { useState, type ReactNode } from "react";
import { modeLabels, type GroceryPlan } from "../../../worker/src/grocery-planning";
import { adjustedMoney, adjustedNumber, commonQuantityComparison } from "../grocery-common-quantity";
import { formatUnitRate } from "../grocery-unit-comparison";
import { Sheet } from "../ui/primitives";
import { grocerySourceLink } from "../grocery-source-link";

export default function GroceryCommonBasket({ plan, renderConditions }: { plan: GroceryPlan; renderConditions: (store: string) => ReactNode }) {
  const [selected, setSelected] = useState<string | null>(null);
  const common = commonQuantityComparison(plan), store = common.stores.find(s => s.group.name === selected);
  const number = adjustedNumber;
  const amount = (n: number) => adjustedMoney(n, plan.currency);
  return <><p className="grocery-common-note">Base commune : {common.count}/{common.total} articles · Quantités ajustées, hors frais · Estimation à revoir</p>
    <div className="grocery-store-grid">{common.stores.filter(s => s.group.retailers.length || ["Fresh St. Market", "Walmart", "Costco", "Superstore"].includes(s.group.name)).map(s => <article className="grocery-basket grocery-common-card" key={s.group.name}>
      <div className="grocery-card-top"><h3>{s.group.name === "Fresh St. Market" ? "Fresh St." : s.group.name}</h3><strong className="grocery-card-amount">{s.amount === null ? "—" : amount(s.amount)}</strong></div>
      <div className="grocery-common-actions"><small className={`grocery-unit-gap grocery-unit-gap-${s.percent === 0 ? "minimum" : s.percent !== null ? "higher" : "neutral"}`}>{s.gap}</small><button type="button" className="text-action" aria-label={`Détails du panier ${s.group.name}`} aria-haspopup="dialog" onClick={() => setSelected(s.group.name)}>Détails</button></div>
    </article>)}</div>
    <Sheet open={!!store} onClose={() => setSelected(null)} title={`Détails du panier ${selected || ""}`} className="grocery-article-details" footer={<button type="button" className="button secondary" onClick={() => setSelected(null)}>Retour aux prix</button>}>
      {store && <><p>Même base de {common.count}/{common.total} articles aux mêmes quantités pour les {common.participants} magasins avec une référence calculable. Montant proportionnel : {store.amount === null ? "inconnu" : amount(store.amount)}. Écart : {store.gap}.</p>
        <p>Écart = (montant normalisé / minimum de la même base - 1) × 100. Les produits liés au même article sont des candidats : marques, variantes, localité, disponibilité et modes restent à revoir. Les paquets différents sont convertis seulement dans la même dimension. Aucun poids, densité ou dose inconnu n'est déduit.</p>
        {store.lines.map(l => { const source = l.offer.p.evidence, link = grocerySourceLink(source.url); return <section className="grocery-product" key={l.item.id}><h3>{l.item.name}</h3><strong>{l.offer.p.product}</strong><p>{modeLabels[l.offer.p.mode ?? "unknown"]} · {l.offer.p.locality || "Localité inconnue"} · {l.offer.p.approved ? "Observation revue" : "Observation non approuvée"} · {l.offer.p.available === "yes" ? "Stock selon source, à reconfirmer" : "Stock non confirmé"}</p><p>{l.selection} {l.item.provisional ? "Besoin provisoire à confirmer." : "Quantité enregistrée du panier."}</p><p>Quantité commune : {number(l.quantity)} {l.label}. Format disponible : {number(l.pack)} {l.label} · {amount(l.offer.p.price)} par format.</p><p>Conversion : {number(l.quantity)} / {number(l.pack)} = {number(l.quantity / l.pack)} format(s) proportionnels · {formatUnitRate(l.offer.rate!, plan.currency)}.</p><p>Montant normalisé : {amount(l.normalized)}. Achat {l.offer.p.weighed ? "au poids" : "de paquets entiers"} : {number(l.packs)} format(s), {amount(l.purchase)}, hors frais/taxes/consignes. L'excédent acheté ne mesure pas la consommation.</p><p className="grocery-evidence">{source.title || "Source à préciser"} · {source.date || "Date inconnue"} · {source.until ? `jusqu'au ${source.until}` : "Validité à vérifier"}{link && <a className="grocery-source-action" href={link.href} target="_blank" rel="noopener noreferrer">{link.label}<span className="sr-only"> {source.title || "Source"} (nouvel onglet)</span></a>}</p></section>; })}
        {!!common.excluded.length && <><h3>Articles exclus de la base commune</h3><ul>{common.excluded.map(i => <li key={i.id}>{i.name} : quantité ou référence compatible manquante dans au moins un magasin participant.</li>)}</ul></>}
        <p>Les magasins sans référence calculable restent inconnus et ne participent pas au minimum. Cette base partielle ne certifie pas un panier complet ni une économie après frais.</p>
        <h3>Montants d'achat et conditions enregistrés</h3>{renderConditions(store.group.name)}
      </>}
    </Sheet>
  </>;
}
