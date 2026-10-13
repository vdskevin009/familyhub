import { useId, useState, type ReactNode } from "react";
import { modeLabels, type GroceryPlan } from "../../../worker/src/grocery-planning";
import { adjustedMoney, adjustedNumber, commonQuantityComparison } from "../grocery-common-quantity";
import { formatUnitRate } from "../grocery-unit-comparison";
import { Sheet } from "../ui/primitives";
import { grocerySourceLink } from "../grocery-source-link";
import { storeGroups } from "../grocery-comparison";

export default function GroceryCommonBasket({ plan, renderConditions }: { plan: GroceryPlan; renderConditions: (store: string) => ReactNode }) {
  const id = useId();
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedStores, setSelectedStores] = useState<string[] | undefined>();
  const choices = storeGroups(plan).filter(g => g.retailers.some(r => r.enabled !== false));
  const chosen = selectedStores?.filter(name => choices.some(g => g.name === name));
  const baseline = commonQuantityComparison(plan);
  const common = chosen ? commonQuantityComparison(plan, undefined, chosen) : baseline, store = common.stores.find(s => s.group.name === selected);
  const number = adjustedNumber;
  const amount = (n: number) => adjustedMoney(n, plan.currency);
  const modes = [...new Set(common.stores.flatMap(s => s.lines.map(l => l.offer.p.mode ?? "unknown")))];
  return <><section className="grocery-common-basket" aria-label="Comparaison des magasins">
    <p className="grocery-common-note">Base commune : {common.count}/{common.total} articles pour le total{common.count < common.total ? " · Partielle" : ""} · Hors frais · Estimation proportionnelle à revoir{modes.length > 1 ? " · Modes mixtes" : ""}</p>
    {common.referenceCount > 0 && <p className="grocery-common-note">{common.referenceCount} article(s) avec une quantité de référence commune. Panier de comparaison, différent du panier réel.</p>}
    <details className="grocery-card-info"><summary>Choisir les magasins du total</summary>
      <p>Comparer moins de magasins peut élargir la base commune. Les prix par article restent visibles pour tous les magasins.</p>
      <fieldset className="grocery-total-stores"><legend>Magasins du total</legend>{choices.map(g => <label key={g.name}><input type="checkbox" checked={(chosen ?? baseline.participantNames).includes(g.name)} onChange={e => { const current = chosen ?? baseline.participantNames; setSelectedStores(e.target.checked ? [...current, g.name] : current.filter(name => name !== g.name)); }} />{g.name}</label>)}</fieldset>
      <button type="button" className="text-action" onClick={() => setSelectedStores(undefined)}>Réinitialiser les magasins</button>
    </details>
    <div className="grocery-price-rows grocery-common-rows">{common.stores.filter(s => s.group.retailers.length || ["Fresh St. Market", "Walmart", "Costco", "Superstore"].includes(s.group.name)).map((s, index) => {
      const storeModes = [...new Set(s.lines.map(l => l.offer.p.mode ?? "unknown"))];
      return <button type="button" className="grocery-price-row grocery-common-row" key={s.group.name} aria-label={`Détails du panier ${s.group.name}`} aria-haspopup="dialog" aria-describedby={`${id}-store-${index} ${id}-price-${index}`} onClick={() => setSelected(s.group.name)}>
        <span className="grocery-common-store" id={`${id}-store-${index}`}><strong>{s.group.name === "Fresh St. Market" ? "Fresh St." : s.group.name}</strong><small>{storeModes.length > 1 ? "Modes mixtes" : storeModes.length ? modeLabels[storeModes[0]] : "Mode à vérifier"}</small></span>
        <span className="grocery-common-price" id={`${id}-price-${index}`}><strong className="grocery-price-value">{s.amount === null ? "—" : amount(s.amount)}</strong><small className={`grocery-unit-gap grocery-unit-gap-${s.percent === 0 ? "minimum" : s.percent !== null ? "higher" : "neutral"}`}>{s.gap}</small></span>
        <span className="grocery-common-details" aria-hidden="true">Détails</span>
      </button>;
    })}</div>
    {common.participants === 0 && <p>Choisissez au moins un magasin pour calculer le total.</p>}
    </section>
    <Sheet open={!!store} onClose={() => setSelected(null)} title={`Détails du panier ${selected || ""}`} className="grocery-article-details grocery-basket-details" footer={<button type="button" className="button secondary" onClick={() => setSelected(null)}>Retour aux prix</button>}>
      {store && <>
        <div className="grocery-basket-total">
          <div><span>Total proportionnel</span><strong>{store.amount === null ? "Inconnu" : amount(store.amount)}</strong></div>
          <small>{common.count}/{common.total} articles{common.count < common.total ? " · Base partielle" : ""} · {store.gap}</small>
          <small>Hors frais, taxes et consignes{modes.length > 1 ? " · Modes mixtes" : ""}</small>
          <small>{store.lines.length && store.lines.every(l => l.offer.p.approved) ? "Prix revus" : "Prix à vérifier"} · Stock à confirmer</small>
          {common.referenceCount > 0 && <small>{common.referenceCount} quantité(s) de référence · Pas le panier réel</small>}
        </div>
        <div className="grocery-basket-lines" aria-label="Articles du total proportionnel">
          {store.lines.map(l => { const source = l.offer.p.evidence, link = grocerySourceLink(source.url); return <details className="grocery-basket-line" key={l.item.id}>
            <summary className="grocery-basket-line-summary">
              <span className="grocery-basket-line-name"><strong>{l.item.name}</strong><small>{number(l.quantity)} {l.label}{l.reference ? " · Référence" : ""}</small></span>
              <span className="grocery-basket-line-price"><strong>{amount(l.normalized)}</strong><small>Proportionnel</small></span>
              <span className="grocery-basket-line-chevron" aria-hidden="true">⌄</span>
            </summary>
            <div className="grocery-basket-line-detail">
              <strong>{l.offer.p.product}</strong>
              <p><strong>Achat {l.offer.p.weighed ? "au poids" : "en paquets entiers"} : {amount(l.purchase)}</strong> · {number(l.packs)} format(s) de {number(l.pack)} {l.label}. Hors frais, taxes et consignes.</p>
              <p>{modeLabels[l.offer.p.mode ?? "unknown"]} · {l.offer.p.locality || "Localité inconnue"} · {l.offer.p.approved ? "Observation revue" : "Observation non approuvée"} · {l.offer.p.available === "yes" ? "Stock selon source, à reconfirmer" : "Stock non confirmé"}</p>
              <p>{l.selection} {l.reference ? "Quantité de référence pour comparer ; le besoin réel reste inchangé." : l.item.provisional ? "Besoin provisoire à confirmer." : "Quantité enregistrée du panier."}</p>
              <p>Format : {number(l.pack)} {l.label} · {amount(l.offer.p.price)}. Conversion : {number(l.quantity)} / {number(l.pack)} = {number(l.quantity / l.pack)} format(s) proportionnels · {formatUnitRate(l.offer.rate!, plan.currency)}. Montant normalisé : {amount(l.normalized)}. L’excédent acheté ne mesure pas la consommation.</p>
              <p className="grocery-evidence">{source.title || "Source à préciser"} · {source.date || "Date inconnue"} · {source.until ? `jusqu’au ${source.until}` : "Validité à vérifier"}{link && <a className="grocery-source-action" href={link.href} target="_blank" rel="noopener noreferrer">{link.label}<span className="sr-only"> {source.title || "Source"} (nouvel onglet)</span></a>}</p>
            </div>
          </details>; })}
        </div>
        <details className="grocery-card-info"><summary>Info sur le calcul</summary><p>Même base de {common.count}/{common.total} articles aux mêmes quantités pour les {common.participants} magasins du calcul. Écart = (montant normalisé / minimum de la même base - 1) × 100. Les quantités de référence comparent des montants équivalents sans modifier le panier réel. Le total proportionnel n’est pas le montant à payer pour des paquets entiers. Produits, marques, variantes, localité, disponibilité et modes restent à revoir. Conversion dans la même dimension seulement : aucun poids, densité ou dose inconnu n’est déduit.</p></details>
        {!!common.excluded.length && <details className="grocery-card-info"><summary>Articles exclus ({common.excluded.length})</summary><ul>{common.exclusionDetails.map(({ item, reason }) => <li key={item.id}>{item.name} : {reason}</li>)}</ul><p>Un article doit avoir une référence compatible dans chaque magasin choisi. Une base partielle ne certifie pas un panier complet ni une économie après frais.</p></details>}
        <details className="grocery-card-info"><summary>Conditions et achats enregistrés</summary>{renderConditions(store.group.name)}</details>
      </>}
    </Sheet>
  </>;
}
