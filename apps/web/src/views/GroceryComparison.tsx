import { compatibleOffers, modeLabels, offerQuantity, type Basket, type Evidence, type GroceryPlan, type GroceryRetailer, type ShoppingItem } from "../../../worker/src/grocery-planning";
import { needLabel } from "../../../worker/src/grocery-weekly";
import { currentPrices, datedPrice, formatLabel, equivalentCost, observedSummary, comparisonStores, priceState, quantityReason, shortProduct, storeGroups, unitPrice, type StoreGroup } from "../grocery-comparison";
const cash = (n: number, c: string) => `${(n / 100).toFixed(2)} ${c}`;
export function PriceSource({ value }: { value: Evidence }) {
  return <p className="grocery-evidence">{value.url ? <a href={value.url} target="_blank" rel="noopener noreferrer">{value.title || "Source"}</a> : value.title || "Source à préciser"} · {value.date || "Date inconnue"} · {value.until ? `jusqu'au ${value.until}` : "Validité à vérifier"}</p>;
}
function Fees({ retailer: r }: { retailer: GroceryRetailer }) {
  const fee = (n: number | null) => n === null ? "?" : n.toFixed(2);
  return <p className="grocery-fee-line">Livr. {fee(r.delivery)} · Service {r.service === null || r.servicePercent === null ? "?" : `${fee(r.service)}${r.servicePercent ? ` + ${r.servicePercent}%` : ""}`} · Min. {fee(r.minimum)}</p>;
}
function BasketInfo({ basket: b, plan }: { basket: Basket; plan: GroceryPlan }) {
  const covered = (household: boolean) => b.lines.some(l => (plan.items.find(i => i.id === l.itemId)?.bucket === "household") === household);
  return <><p>Alimentation {covered(false) ? cash(b.foodSubtotal, plan.currency) : "non chiffrable"} · Maison {covered(true) ? cash(b.householdSubtotal, plan.currency) : "non chiffrable"}</p>
    {b.orders.map(o => { const r = plan.retailers.find(r => r.id === o.retailerId)!; return <section className="grocery-product" key={o.retailerId}><strong>{r.name} · {modeLabels[r.mode ?? "unknown"]}</strong><dl className="grocery-costs">{[["Produits", o.subtotal], ["Taxes produits", o.tax], ["Livraison", o.delivery], ["Service", o.service], ["Taxes sur frais", o.feesTax], ["Consignes", o.deposit], ["Abonnement / semaine", o.membership], ["Pourboire optionnel", o.tip]].map(([name, amount]) => <div key={name}><dt>{name}</dt><dd>{amount === null ? "À vérifier" : cash(amount as number, plan.currency)}</dd></div>)}</dl><PriceSource value={r.evidence} /></section>; })}
    {b.lines.map(line => {
      const price = plan.prices.find(p => p.id === line.priceId)!;
      return <section className="grocery-product" key={line.itemId}><strong>{price.product}</strong><p>{Number(line.quantity.toFixed(3))} × {price.size} {price.unit} · {cash(line.cost, plan.currency)}{price.substitution ? " · Substitution revue" : ""}</p><PriceSource value={price.evidence} /></section>;
    })}
    {!!b.missing.length && <ul className="grocery-missing">{b.missing.map(s => <li key={s}>{s}</li>)}</ul>}
  </>;
}
export function CompactBasket({ basket: b, plan }: { basket: Basket; plan: GroceryPlan }) {
  return <article className="grocery-basket"><div className="grocery-card-top"><h4>{b.name}</h4><span className="grocery-card-amount">{b.total === null ? b.coverage ? cash(b.subtotal, plan.currency) : "—" : cash(b.total, plan.currency)}</span></div><p>{b.coverage}/{b.count} articles · {b.total === null ? "Sous-total partiel" : b.eligible ? "Panier complet estimé" : "Panier complet conditionnel"}</p><details className="grocery-card-info"><summary aria-label={`Info ${b.name}`}>Info</summary><BasketInfo basket={b} plan={plan} /></details></article>;
}
export function StoreCards({ plan, comparison, onEdit }: {
  plan: GroceryPlan;
  comparison: ReturnType<typeof import("../../../worker/src/grocery-planning").compareBaskets>;
  onEdit?: (retailer: GroceryRetailer) => void;
}) {
  const items = plan.items.filter(i => i.active);
  const groups = storeGroups(plan).filter(g => onEdit || comparisonStores.includes(g.name) || g.retailers.some(r => plan.prices.some(p => p.retailerId === r.id && items.some(i => i.id === p.itemId))));
  return <div className="grocery-store-grid">{groups.map(g => {
    const r = [...g.retailers].sort((a, b) => Number(/catalogue/i.test(a.name)) - Number(/catalogue/i.test(b.name)) || observedSummary(plan, b).known - observedSummary(plan, a).known)[0];
    const s = r ? observedSummary(plan, r) : null;
    const basket = r ? comparison.whole.find(b => b.lines.some(l => l.retailerId === r.id)) : undefined;
    const complete = basket?.total !== null && basket?.total !== undefined;
    const amount = complete ? cash(basket!.total!, plan.currency) : s?.subtotal !== null && s?.subtotal !== undefined ? cash(s.subtotal, plan.currency) : "—";
    const state = complete ? basket!.eligible ? "Panier complet estimé" : "Panier complet conditionnel" : s?.subtotal !== null && s?.subtotal !== undefined ? "Sous-total partiel observé" : "Montant inconnu";
    return <article className="grocery-basket grocery-store-card" key={g.name}>
      <div className="grocery-card-top"><h3>{g.name === "Fresh St. Market" ? "Fresh St." : g.name}</h3><span className="grocery-card-amount">{amount}</span></div>
      <p className="grocery-card-state">{state}</p>
      {!complete && s && <small>{s.priced}/{items.length} articles chiffrables</small>}
      <p>{s?.known ?? 0}/{items.length} prix · {r ? modeLabels[r.mode ?? "unknown"] : "Mode à vérifier"}</p>
      {r ? <Fees retailer={r} /> : <p className="grocery-fee-line">Frais à vérifier</p>}
      <details className="grocery-card-info"><summary aria-label={"Info " + g.name}>Info</summary>{r ? <>
        <p>{s?.priced ?? 0} référence(s) chiffrable(s), paquets entiers ; frais, taxes et quantités manquantes exclus du sous-total.</p>
        <p>Alimentation {s?.foodPriced ? cash(s.food, plan.currency) : "non chiffrable"} · Maison {s?.householdPriced ? cash(s.household, plan.currency) : "non chiffrable"}</p>
        <p>{r.locality || "Localité à vérifier"} · {r.areaConfirmed ? "Zone confirmée" : "Zone à vérifier"} · {r.enabled === false ? "Hors comparaison" : "Dans la comparaison"}</p>
        <PriceSource value={r.evidence} />
        {r.minimum === null && <p>Minimum de commande inconnu.</p>}
        <p>Taxes, consignes, abonnement et autres frais : {r.otherFeesReviewed ? "voir les valeurs renseignées" : "à vérifier"}.</p>
        {!!s!.missing.length && <ul className="grocery-missing">{s!.missing.map(m => <li key={m.name}>{m.name} : {m.reason}</li>)}</ul>}
        {basket && <BasketInfo basket={basket} plan={plan} />}
        {g.retailers.length > 1 && <><p>Autres modes ou catalogues, présentés séparément :</p>{g.retailers.filter(x => x.id !== r.id).map(x => <section className="grocery-product" key={x.id}>
          <strong>{x.name} · {modeLabels[x.mode ?? "unknown"]}</strong><p>{observedSummary(plan, x).known}/{items.length} prix. Leurs montants ne sont pas additionnés au mode ci-dessus.</p><PriceSource value={x.evidence} />
          {onEdit && <button className="text-action grocery-card-edit" onClick={() => onEdit(x)} aria-label={"Modifier " + x.name + " " + modeLabels[x.mode ?? "unknown"]}>Modifier</button>}
        </section>)}</>}
      </> : <p>Pas encore de référence sourcée pour cette enseigne. Aucun prix ni disponibilité n'est déduit.</p>}</details>
      {onEdit && r && <button className="text-action grocery-card-edit" onClick={() => onEdit(r)} aria-label={"Modifier " + g.name + " " + modeLabels[r.mode ?? "unknown"]}>Modifier</button>}
    </article>;
  })}</div>;
}
function ArticleComparison({ plan, item, groups }: { plan: GroceryPlan; item: ShoppingItem; groups: StoreGroup[] }) {
  const included = new Set(compatibleOffers(plan, item).map(p => p.id));
  return <article className="grocery-article-comparison">
    <div className="grocery-section-heading"><h3>{item.name}</h3><small>{needLabel(item, true)}{item.provisional ? " · Provisoire" : ""}</small></div>
    <div className="grocery-price-rows">{groups.map(g => {
      const allOffers = g.retailers.flatMap(r => currentPrices(plan, item, r).map(p => ({ r, p })));
      const offers = allOffers.some(o => !/catalogue par défaut/i.test(o.r.name)) ? allOffers.filter(o => !/catalogue par défaut/i.test(o.r.name)) : allOffers;
      return <div className="grocery-price-row" key={g.name}><strong>{g.name}</strong><div>{offers.length ? offers.map(({ r, p }) =>
        <div className="grocery-price-option" key={p.id}>
          <div><span className="grocery-price-value">{p.price.toFixed(2)} {p.currency}{p.weighed ? " / " + p.size + " " + p.unit : ""}</span><small>{priceState(p, r)}{g.retailers.length > 1 || p.mode !== r.mode ? " · " + modeLabels[p.mode ?? "unknown"] : ""}</small></div>
          <small className="grocery-price-reference">{shortProduct(p.product)} · {formatLabel(p, item)}{p.usesPerPack ? " / " + p.usesPerPack + " utilisations" : ""}</small>
          <small>{unitPrice(p)}</small>
        </div>) : <div className="grocery-price-option"><span className="grocery-price-value">—</span><small>Prix manquant</small></div>}</div></div>;
    })}</div>
    <details className="grocery-card-info"><summary aria-label={"Info prix " + item.name}>Info</summary>
      <p>Besoin : {needLabel(item, true)}. {item.provisional ? "Quantité provisoire à confirmer." : ""}</p>
      {groups.map(g => {
        const offers = g.retailers.flatMap(r => plan.prices.filter(p => p.itemId === item.id && p.retailerId === r.id));
        return <section className="grocery-product" key={g.name}><h4>{g.name}</h4>{offers.map(p => {
          const packs = offerQuantity(item, p), equivalent = equivalentCost(item, p);
          return <div className="grocery-offer-row" key={p.id}>
            <strong>{p.product}</strong><span>{p.price.toFixed(2)} {p.currency} / {formatLabel(p, item)} · {unitPrice(p)}</span>
            <small>{modeLabels[p.mode ?? "unknown"]} · {p.locality || "Localité inconnue"} · {p.approved ? "Observation revue" : "Observation non approuvée"} · {p.available === "yes" ? "Stock selon source, à reconfirmer" : p.available === "no" ? "Indisponible selon source" : "Stock non confirmé"}</small>
            <p>{p.matchNote || "Marque, variante et format à revoir."}</p>
            <p>{quantityReason(item, p) || (packs === null ? "Montant du besoin inconnu" : "Achat de " + Number(packs.toFixed(3)) + " format(s) : " + cash(Math.round(packs * p.price * 100), plan.currency) + ", hors frais et taxes.")}{included.has(p.id) ? " Référence incluse dans les calculs." : " Référence non utilisée pour un panier complet."}</p>
            {equivalent !== null && <p>Équivalent proportionnel du besoin : {Number(equivalent.toFixed(4))} {plan.currency}. Ce montant diffère de l'achat des paquets entiers et ne mesure pas la consommation réelle.</p>}
            <PriceSource value={p.evidence} />
          </div>;
        })}{!offers.length && <p>Pas encore de prix sourcé pour cet article. Ce n'est pas une preuve d'indisponibilité.</p>}</section>;
      })}
    </details>
  </article>;
}

export default function GroceryComparison({ plan, comparison }: { plan: GroceryPlan; comparison: ReturnType<typeof import("../../../worker/src/grocery-planning").compareBaskets> }) {
  const items = plan.items.filter(i => i.active);
  const groups = storeGroups(plan).filter(g => comparisonStores.includes(g.name) || g.retailers.some(r => plan.prices.some(p => p.retailerId === r.id && items.some(i => i.id === p.itemId))));
  const known = items.filter(i => plan.prices.some(p => p.itemId === i.id && datedPrice(p) && p.available !== "no")).length;
  return <>
    <section className="grocery-comparison-status" aria-label="État des prix">
      <strong>{known}/{items.length} articles avec un prix observé</strong>
      <small>{comparison.coverage}/{items.length} références validées pour le total · {comparison.best ? "Panier estimé disponible" : "Totaux complets non confirmés"}{comparison.truncated ? " · Calcul limité" : ""}</small>
      <details className="grocery-card-info"><summary>Info sur les montants</summary>
        <p>Un prix observé reste un candidat jusqu'à la revue du produit, du format, de la localité et du mode. Un sous-total partiel couvre uniquement les références chiffrables, hors frais et taxes non confirmés.</p>
        <p>Les paquets entiers sont arrondis à l'achat ; l'équivalent proportionnel du besoin ne mesure ni stock disponible ni consommation réelle.</p>
        {comparison.best && <p>Estimation la plus basse parmi les options entièrement renseignées : {comparison.best.name}, {cash(comparison.best.total!, plan.currency)}. À reconfirmer avant achat.</p>}
      </details>
    </section>
    <StoreCards plan={plan} comparison={comparison} />
    <h3>Prix par article</h3>{!items.length && <p className="grocery-empty">Aucun article dans ce panier.</p>}
    {items.map(item => <ArticleComparison key={item.id} plan={plan} item={item} groups={groups} />)}
    {!!comparison.split.length && <details className="grocery-info"><summary>Paniers répartis</summary><div className="grocery-store-grid">{comparison.split.map(b => <CompactBasket key={b.key} basket={b} plan={plan} />)}</div></details>}
  </>;
}
