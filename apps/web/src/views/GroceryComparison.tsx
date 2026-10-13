import { useState } from "react";
import { compatibleOffers, modeLabels, offerQuantity, type Basket, type Evidence, type GroceryPlan, type GroceryPrice, type GroceryRetailer, type ShoppingItem } from "../../../worker/src/grocery-planning";
import { needLabel } from "../../../worker/src/grocery-weekly";
import { datedPrice, formatLabel, equivalentCost, observedSummary, comparisonStores, priceState, quantityReason, shortProduct, storeGroups, type StoreGroup } from "../grocery-comparison";
import { articleComparisonCoverage, articleUnitComparison, formatUnitRate, observedUnitRate, type RankedOffer } from "../grocery-unit-comparison";
import { grocerySourceLink } from "../grocery-source-link";
import { Sheet } from "../ui/primitives";
import GroceryCommonBasket from "./GroceryCommonBasket";
import type { ReceiptProduct } from "../grocery-receipt-products";
import { ArticleReceiptProducts, StoreReceiptProducts } from "./GroceryReceiptProducts";
import { adjustedMoney, adjustedNumber, adjustedOfferQuantity } from "../grocery-common-quantity";
import { packagePrice } from "../grocery-price-display";
const cash = (n: number, c: string) => `${(n / 100).toFixed(2)} ${c}`;
export function PriceSource({ value }: { value: Evidence }) {
  const link = grocerySourceLink(value.url);
  return <p className="grocery-evidence">{value.title || "Source à préciser"} · {value.date || "Date inconnue"} · {value.until ? `jusqu'au ${value.until}` : "Validité à vérifier"}{link && <a className="grocery-source-action" href={link.href} target="_blank" rel="noopener noreferrer">{link.label} <span className="sr-only">{value.title || "Source"} (nouvel onglet)</span></a>}</p>;
}
function Fees({ retailer: r }: { retailer: GroceryRetailer }) {
  const fee = (n: number | null) => n === null ? "?" : n.toFixed(2);
  return <p className="grocery-fee-line">Livr. {fee(r.delivery)} · Service {r.service === null || r.servicePercent === null ? "?" : `${fee(r.service)}${r.servicePercent ? ` + ${r.servicePercent}%` : ""}`} · Min. {fee(r.minimum)}</p>;
}
function BasketInfo({ basket: b, plan, products = [] }: { basket: Basket; plan: GroceryPlan; products?: ReceiptProduct[] }) {
  const covered = (household: boolean) => b.lines.some(l => (plan.items.find(i => i.id === l.itemId)?.bucket === "household") === household);
  return <><p>Alimentation {covered(false) ? cash(b.foodSubtotal, plan.currency) : "non chiffrable"} · Maison {covered(true) ? cash(b.householdSubtotal, plan.currency) : "non chiffrable"}</p>
    {b.orders.map(o => { const r = plan.retailers.find(r => r.id === o.retailerId)!; return <section className="grocery-product" key={o.retailerId}><strong>{r.name} · {modeLabels[r.mode ?? "unknown"]}</strong><dl className="grocery-costs">{[["Produits", o.subtotal], ["Taxes produits", o.tax], ["Livraison", o.delivery], ["Service", o.service], ["Taxes sur frais", o.feesTax], ["Consignes", o.deposit], ["Abonnement / semaine", o.membership], ["Pourboire optionnel", o.tip]].map(([name, amount]) => <div key={name}><dt>{name}</dt><dd>{amount === null ? "À vérifier" : cash(amount as number, plan.currency)}</dd></div>)}</dl><PriceSource value={r.evidence} /></section>; })}
    {b.lines.map(line => {
      const price = plan.prices.find(p => p.id === line.priceId)!;
      return <section className="grocery-product" key={line.itemId}><strong>{price.product}</strong><p>{Number(line.quantity.toFixed(3))} × {price.size} {price.unit} · {cash(line.cost, plan.currency)}{price.substitution ? " · Substitution revue" : ""}</p><PriceSource value={price.evidence} /><ArticleReceiptProducts itemId={line.itemId} products={products} /></section>;
    })}
    {!!b.missing.length && <ul className="grocery-missing">{b.missing.map(s => <li key={s}>{s}</li>)}</ul>}
  </>;
}
export function CompactBasket({ basket: b, plan, products = [] }: { basket: Basket; plan: GroceryPlan; products?: ReceiptProduct[] }) {
  return <article className="grocery-basket"><div className="grocery-card-top"><h4>{b.name}</h4><span className="grocery-card-amount">{b.total === null ? b.coverage ? cash(b.subtotal, plan.currency) : "—" : cash(b.total, plan.currency)}</span></div><p>{b.coverage}/{b.count} articles · {b.total === null ? "Sous-total partiel" : b.eligible ? "Panier complet estimé" : "Panier complet conditionnel"}</p><details className="grocery-card-info"><summary aria-label={`Info ${b.name}`}>Info</summary><BasketInfo basket={b} plan={plan} products={products} /></details></article>;
}
export function StoreCards({ plan, comparison, onEdit, onlyStore, products = [] }: {
  plan: GroceryPlan;
  comparison: ReturnType<typeof import("../../../worker/src/grocery-planning").compareBaskets>;
  onEdit?: (retailer: GroceryRetailer) => void;
  onlyStore?: string;
  products?: ReceiptProduct[];
}) {
  const items = plan.items.filter(i => i.active);
  const groups = storeGroups(plan).filter(g => (!onlyStore || g.name === onlyStore) && (onEdit || comparisonStores.includes(g.name) || g.retailers.some(r => plan.prices.some(p => p.retailerId === r.id && items.some(i => i.id === p.itemId)))));
  return <div className={`grocery-store-grid${onlyStore ? " grocery-store-single" : ""}`}>{groups.map(g => {
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
        {basket && <BasketInfo basket={basket} plan={plan} products={products} />}
        <StoreReceiptProducts plan={plan} products={products} retailerIds={g.retailers.map(r => r.id)} />
        {g.retailers.length > 1 && <><p>Autres modes ou catalogues, présentés séparément :</p>{g.retailers.filter(x => x.id !== r.id).map(x => <section className="grocery-product" key={x.id}>
          <strong>{x.name} · {modeLabels[x.mode ?? "unknown"]}</strong><p>{observedSummary(plan, x).known}/{items.length} prix. Leurs montants ne sont pas additionnés au mode ci-dessus.</p><PriceSource value={x.evidence} />
          {onEdit && <button className="text-action grocery-card-edit" onClick={() => onEdit(x)} aria-label={"Modifier " + x.name + " " + modeLabels[x.mode ?? "unknown"]}>Modifier</button>}
        </section>)}</>}
      </> : <p>Pas encore de référence sourcée pour cette enseigne. Aucun prix ni disponibilité n'est déduit.</p>}</details>
      {onEdit && r && <button className="text-action grocery-card-edit" onClick={() => onEdit(r)} aria-label={"Modifier " + g.name + " " + modeLabels[r.mode ?? "unknown"]}>Modifier</button>}
    </article>;
  })}</div>;
}
/** Information only: the existing observed-unit ranking owns every comparison badge. */
export function ArticleOfferCard({ plan, item, p, r, ranked, included }: {
  plan: GroceryPlan; item: ShoppingItem; p: GroceryPrice; r: GroceryRetailer; ranked?: RankedOffer; included: boolean;
}) {
  const short = shortProduct(p.product);
  // Only a literal known prefix separated from the rest is a brand. Unknown names stay unknown.
  const brand = short !== p.product && /^[\s,.:;–—-]/u.test(p.product.slice(short.length)) ? p.product.slice(0, short.length) : null;
  const product = brand ? p.product.slice(brand.length).replace(/^[\s,.:;–—-]+/u, "") : p.product;
  const rate = ranked?.rate ?? observedUnitRate(item, p);
  const unitLabel = rate?.basis === "l" ? "Prix pour 1 L" : rate?.basis === "kg" ? "Prix pour 1 kg" : rate ? `Prix par ${rate.label}` : "Prix unitaire";
  const gap = ranked?.reason || !ranked ? "Non comparable" : ranked.gap === "Plus bas observé · 0 %" ? "Le moins cher" : ranked.gap;
  const tone = ranked?.tone ?? "neutral";
  const adjusted = ranked ? adjustedOfferQuantity(item, ranked) : null;
  const packs = adjusted?.packs ?? offerQuantity(item, p), equivalent = adjusted?.normalized ?? equivalentCost(item, p);
  const state = priceState(p, r);
  const warning = ranked?.reason || (!ranked ? "Référence hors classement" : state !== "Revu" ? state : "");
  const limits = [warning, p.available === "unknown" ? "Stock à confirmer" : "", !r.otherFeesReviewed || r.delivery === null || r.service === null || p.taxPercent === null || p.depositPerPack == null ? "Frais à vérifier" : ""].filter(Boolean);
  return <article className="grocery-offer-card">
    <div className="grocery-offer-header"><h4>{r.name}</h4><span className={`grocery-unit-gap grocery-unit-gap-${tone}`} aria-label={ranked?.reason || ranked?.gap || "Référence hors classement, aucun pourcentage comparable"} title="Comparaison des prix unitaires observés, hors frais ; marque, variante et mode à revoir">{gap}</span></div>
    <dl className="grocery-offer-fields">
      <div><dt>Marque</dt><dd><strong>{brand || "Non précisée"}</strong></dd></div>
      <div><dt>Produit</dt><dd>{product || "Non précisé"}</dd></div>
      <div><dt>Format</dt><dd>{formatLabel(p, item)}</dd></div>
    </dl>
    <dl className="grocery-offer-prices">
      <div><dt>Prix du format</dt><dd>{new Intl.NumberFormat("fr-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(p.price)} {p.currency}</dd></div>
      <div><dt>{unitLabel}</dt><dd>{rate ? formatUnitRate(rate, p.currency).split("/")[0] : "Non calculable"}</dd></div>
    </dl>
    <p className="grocery-offer-context">{modeLabels[p.mode ?? "unknown"]} · {p.locality || "Localité inconnue"}</p>
    {!!limits.length && <p className="grocery-offer-warning">{[...new Set(limits)].join(" · ")}</p>}
    <details className="grocery-offer-source"><summary>Source et conditions <span className="sr-only">— {r.name}, {p.product}, {modeLabels[p.mode ?? "unknown"]}</span><span className="grocery-offer-chevron" aria-hidden="true">›</span></summary>
      <div className="grocery-offer-source-content">
        <PriceSource value={p.evidence} />
        <p>Référence : {p.product}. {ranked?.reason || ranked?.gap || "Référence hors classement"}. {ranked?.reason || !ranked ? "Aucun pourcentage comparable calculé." : "Écart au minimum observé dans la même unité et devise, hors frais."}</p>
        <p>{modeLabels[p.mode ?? "unknown"]} · {p.locality || "Localité inconnue"} · {p.localityConfirmed ? "Localité confirmée" : "Localité à confirmer"} · {p.approved ? "Observation revue" : "Observation non approuvée"} · {p.available === "yes" ? "Stock selon source, à reconfirmer" : p.available === "no" ? "Indisponible selon source" : "Stock non confirmé"}</p>
        <p>{p.matchNote || "Marque, variante et format à revoir."}</p>
        {adjusted && <p>Quantité commune : {adjustedNumber(adjusted.quantity)} {adjusted.label}. Conversion : {adjustedNumber(adjusted.quantity)} / {adjustedNumber(adjusted.pack)} = {adjustedNumber(adjusted.quantity / adjusted.pack)} format(s) proportionnels. {adjusted.reference ? "Quantité de référence pour comparer ; le besoin réel reste inchangé." : "Quantité du panier enregistrée."} Format candidat à revoir.</p>}
        <p>{(!adjusted && quantityReason(item, p)) || (packs === null ? "Montant du besoin inconnu" : "Achat de " + Number(packs.toFixed(3)) + " format(s) : " + cash(Math.round(packs * p.price * 100), plan.currency) + ", hors frais et taxes.")}{included ? " Référence incluse dans les calculs." : " Référence non utilisée pour un panier complet."}</p>
        {equivalent !== null && <p>{adjusted?.reference ? "Montant proportionnel de référence" : "Équivalent proportionnel du besoin"} : {equivalent > 0 && equivalent < .0001 ? adjustedMoney(equivalent, plan.currency) : `${Number(equivalent.toFixed(4))} ${plan.currency}`}. Ce montant diffère de l'achat des paquets entiers et ne mesure pas la consommation réelle.</p>}
        <p>Taxes produits : {p.taxPercent === null ? "à vérifier" : `${p.taxPercent} %`} · Consigne par format : {p.depositPerPack == null ? "à vérifier" : `${p.depositPerPack.toFixed(2)} ${p.currency}`}</p>
        <div className="grocery-detail-conditions"><strong>Conditions · {r.name} · {modeLabels[r.mode ?? "unknown"]}</strong><Fees retailer={r} /><p>Livraison gratuite dès : {r.freeDeliveryAbove === null ? "à vérifier" : `${r.freeDeliveryAbove.toFixed(2)} ${plan.currency}`} · Taxes sur frais : {r.feesTaxPercent === null ? "à vérifier" : `${r.feesTaxPercent} %`}</p><p>Abonnement : {r.membershipStatus === "none" ? "aucun" : r.membershipStatus === "existing" ? "existant" : r.membershipStatus === "proposal" ? "proposition à confirmer" : "à vérifier"} · Coût hebdomadaire : {r.membershipWeekly == null ? "à vérifier" : `${r.membershipWeekly.toFixed(2)} ${plan.currency}`}. {r.membershipNote}</p><p>{r.locality || "Localité à vérifier"} · {r.areaConfirmed ? "Zone confirmée" : "Zone à vérifier"} · {r.slots === "yes" ? "Créneaux selon source" : r.slots === "no" ? "Pas de créneau selon source" : "Créneaux à vérifier"} · {r.otherFeesReviewed ? "Frais revus" : "Autres frais à vérifier"} · Pourboire optionnel : {plan.tipPerOrder.toFixed(2)} {plan.currency}</p><PriceSource value={r.evidence} /></div>
      </div>
    </details>
  </article>;
}

export function ArticleComparison({ plan, item, groups, products, showComparison = true, identity, format }: { plan: GroceryPlan; item: ShoppingItem; groups: StoreGroup[]; products: ReceiptProduct[]; showComparison?: boolean; identity?: React.ReactNode; format?: React.ReactNode }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const included = new Set(compatibleOffers(plan, item).map(p => p.id));
  const unitComparison = articleUnitComparison(plan, item, groups);
  const needsReview = !unitComparison.comparableCount || unitComparison.rows.flatMap(row => row.offers).some(o => o.reason || !o.p.approved || o.p.available !== "yes" || !o.p.localityConfirmed || !o.r.areaConfirmed || !plan.areaConfirmed || !o.p.evidence.until || o.p.substitution && (!item.substitutions || !o.p.matchNote?.trim()));
  return <article className="grocery-article-comparison">
    <div className="grocery-article-heading"><h3>{item.name}</h3>{identity ? <span className="grocery-quantity-chip">{format}</span> : <button type="button" className="text-action" aria-label={`Détails de ${item.name}`} aria-haspopup="dialog" onClick={() => setDetailsOpen(true)}>Détails</button>}</div>
    {identity}
    {identity && showComparison && <div className="grocery-price-headings" aria-hidden="true"><span>Magasin</span><span>Prix / unité</span><span>Écart min.</span></div>}
    {showComparison && <div className="grocery-price-rows">{unitComparison.rows.map(({ group: g, offers }) => {
      return <div className="grocery-price-row" key={g.name}><strong>{g.name === "Fresh St. Market" ? "Fresh St." : g.name}</strong><div>{offers.length ? offers.map(({ p, rate, reason, gap, tone }) =>
        <div className="grocery-price-option" key={p.id}>
          <span className="grocery-price-value">{identity ? <><strong>{packagePrice(p.price, p.currency)}</strong><small>{!reason && rate ? formatUnitRate(rate, p.currency) : p.available === "no" ? "Indisponible" : !datedPrice(p) ? "Historique" : !p.mode || p.mode === "unknown" ? "Mode à confirmer" : "Non comparable"}</small><small>{formatLabel(p, item)}</small></> : !reason && rate ? formatUnitRate(rate, p.currency) : p.available === "no" ? "Indisponible" : !datedPrice(p) ? "Historique" : !p.mode || p.mode === "unknown" ? "Mode à confirmer" : "Non comparable"}</span>
          <small className={`grocery-unit-gap grocery-unit-gap-${tone}`} aria-label={gap} title={reason || "Écart au minimum observé dans la même unité et devise, hors frais"}>{gap === "Plus bas observé · 0 %" ? "0 %" : gap === "Ex æquo · 0 %" ? "0 % ex æquo" : reason ? "-" : gap}</small>
          {identity && <small className="grocery-price-mode">{modeLabels[p.mode ?? "unknown"]}{p.substitution ? " · Substitution" : ""}{!p.approved ? " · À revoir" : ""}{reason ? " · " + reason : ""}</small>}
        </div>) : <div className="grocery-price-option"><span className="grocery-price-value">Prix manquant</span><small className="grocery-unit-gap grocery-unit-gap-neutral">—</small></div>}</div></div>;
    })}</div>}
    {identity && <div className="grocery-catalogue-card-footer"><span className={needsReview ? "grocery-price-review" : "grocery-price-observed"}>{needsReview ? "Prix à vérifier" : "Prix unitaires observés"}</span><button type="button" className="text-action grocery-details-action" aria-label={`Détails de ${item.name}`} aria-haspopup="dialog" onClick={() => setDetailsOpen(true)}>Détails</button></div>}
    <Sheet open={detailsOpen} onClose={() => setDetailsOpen(false)} title="Détails du produit" className="grocery-article-details" resetScrollOnOpen footer={<button type="button" className="button secondary" onClick={() => setDetailsOpen(false)}>Retour aux prix</button>}>
      <div className="grocery-product-heading"><h3>{item.name}</h3><p>Prix et détails par magasin</p></div>
      {identity}
      <div className="grocery-offer-cards">{unitComparison.rows.map(({ group: g, offers: rankedOffers }) => {
        // Retain older observations and separate modes; only current ranked offers get a gap.
        const offers = g.retailers.flatMap(r => plan.prices.filter(p => p.itemId === item.id && p.retailerId === r.id));
        const ordered = [...rankedOffers.map(o => o.p), ...offers.filter(p => !rankedOffers.some(o => o.p.id === p.id))];
        return ordered.length ? ordered.map(p => <ArticleOfferCard key={p.id} plan={plan} item={item} p={p} r={g.retailers.find(r => r.id === p.retailerId)!} ranked={rankedOffers.find(o => o.p.id === p.id)} included={included.has(p.id)} />)
          : <section className="grocery-offer-card grocery-offer-empty" key={g.name}><h4>{g.name}</h4><p>Pas encore de prix sourcé pour cet article. Ce n'est pas une preuve d'indisponibilité.</p></section>;
      })}</div>
      <details className="grocery-card-info grocery-comparison-info"><summary>Info sur la comparaison</summary>
        <p>Besoin : {needLabel(item, true)}. {item.provisional ? "Quantité provisoire à confirmer." : ""}</p>
        <p>Tri par prix unitaire observé, hors frais de commande. Écart = (prix unitaire / minimum comparable - 1) x 100. Les modes, marques et variantes restent à revoir ; ce classement ne valide ni une équivalence ni un panier complet.</p>
        <ArticleReceiptProducts itemId={item.id} products={products} />
      </details>
    </Sheet>
  </article>;
}

export default function GroceryComparison({ plan, comparison, products = [] }: { plan: GroceryPlan; comparison: ReturnType<typeof import("../../../worker/src/grocery-planning").compareBaskets>; products?: ReceiptProduct[] }) {
  const items = plan.items.filter(i => i.active);
  const groups = storeGroups(plan).filter(g => comparisonStores.includes(g.name) || g.retailers.some(r => plan.prices.some(p => p.retailerId === r.id && items.some(i => i.id === p.itemId))));
  const known = items.filter(i => plan.prices.some(p => p.itemId === i.id && datedPrice(p) && p.available !== "no")).length;
  const unitCoverage = articleComparisonCoverage(plan, groups);
  return <>
    <section className="grocery-comparison-status" aria-label="État des prix">
      <strong>{unitCoverage.count}/{unitCoverage.total} articles comparables par prix unitaire</strong>
      <small>{comparison.best ? "Panier estimé disponible" : "Totaux complets non confirmés"}{comparison.truncated ? " · Calcul limité" : ""}</small>
      <details className="grocery-card-info"><summary>Info sur les montants</summary>
        <p>{known}/{items.length} articles avec un prix observé · {comparison.coverage}/{items.length} références validées pour le total.</p>
        <p>Les prix unitaires se comparent même si la quantité du panier est inconnue. Le total commun conserve les quantités calculables et utilise une quantité de référence commune lorsque le besoin physique est inconnu. Un prix compatible reste nécessaire dans chaque magasin choisi.</p>
        <p>Un prix observé reste un candidat jusqu'à la revue du produit, du format, de la localité et du mode. Un sous-total partiel couvre uniquement les références chiffrables, hors frais et taxes non confirmés.</p>
        <p>Les paquets entiers sont arrondis à l'achat ; l'équivalent proportionnel du besoin ne mesure ni stock disponible ni consommation réelle.</p>
        {comparison.best && <p>Estimation la plus basse parmi les options entièrement renseignées : {comparison.best.name}, {cash(comparison.best.total!, plan.currency)}. À reconfirmer avant achat.</p>}
      </details>
    </section>
    <GroceryCommonBasket plan={plan} products={products} renderConditions={store => <StoreCards plan={plan} comparison={comparison} products={products} onlyStore={store} />} />
    <div><h3>Prix par article</h3></div>{!items.length && <p className="grocery-empty">Aucun article dans ce panier.</p>}
    {items.map(item => <ArticleComparison key={item.id} plan={plan} item={item} groups={groups} products={products} />)}
    {!!comparison.split.length && <details className="grocery-info"><summary>Paniers répartis</summary><div className="grocery-store-grid">{comparison.split.map(b => <CompactBasket key={b.key} basket={b} plan={plan} products={products} />)}</div></details>}
  </>;
}
