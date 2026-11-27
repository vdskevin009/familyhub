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
  return <p className="grocery-evidence">{value.title || "Source needed"} · {value.date || "Date unknown"} · {value.until ? `until ${value.until}` : "Validity needs checking"}{link && <a className="grocery-source-action" href={link.href} target="_blank" rel="noopener noreferrer">{link.label} <span className="sr-only">{value.title || "Source"} (new tab)</span></a>}</p>;
}
function Fees({ retailer: r }: { retailer: GroceryRetailer }) {
  const fee = (n: number | null) => n === null ? "?" : n.toFixed(2);
  return <p className="grocery-fee-line">Delivery {fee(r.delivery)} · Service {r.service === null || r.servicePercent === null ? "?" : `${fee(r.service)}${r.servicePercent ? ` + ${r.servicePercent}%` : ""}`} · Min. {fee(r.minimum)}</p>;
}
function BasketInfo({ basket: b, plan, products = [] }: { basket: Basket; plan: GroceryPlan; products?: ReceiptProduct[] }) {
  const covered = (household: boolean) => b.lines.some(l => (plan.items.find(i => i.id === l.itemId)?.bucket === "household") === household);
  return <><p>Alimentation {covered(false) ? cash(b.foodSubtotal, plan.currency) : "non chiffrable"} · Maison {covered(true) ? cash(b.householdSubtotal, plan.currency) : "non chiffrable"}</p>
    {b.orders.map(o => { const r = plan.retailers.find(r => r.id === o.retailerId)!; return <section className="grocery-product" key={o.retailerId}><strong>{r.name} · {modeLabels[r.mode ?? "unknown"]}</strong><dl className="grocery-costs">{[["Items", o.subtotal], ["Item taxes", o.tax], ["Delivery", o.delivery], ["Service", o.service], ["Tax on fees", o.feesTax], ["Deposits", o.deposit], ["Membership per week", o.membership], ["Optional tip", o.tip]].map(([name, amount]) => <div key={name}><dt>{name}</dt><dd>{amount === null ? "Needs review" : cash(amount as number, plan.currency)}</dd></div>)}</dl><PriceSource value={r.evidence} /></section>; })}
    {b.lines.map(line => {
      const price = plan.prices.find(p => p.id === line.priceId)!;
      return <section className="grocery-product" key={line.itemId}><strong>{price.product}</strong><p>{Number(line.quantity.toFixed(3))} × {price.size} {price.unit} · {cash(line.cost, plan.currency)}{price.substitution ? " · Reviewed substitution" : ""}</p><PriceSource value={price.evidence} /><ArticleReceiptProducts itemId={line.itemId} products={products} /></section>;
    })}
    {!!b.missing.length && <ul className="grocery-missing">{b.missing.map(s => <li key={s}>{s}</li>)}</ul>}
  </>;
}
export function CompactBasket({ basket: b, plan, products = [] }: { basket: Basket; plan: GroceryPlan; products?: ReceiptProduct[] }) {
  return <article className="grocery-basket"><div className="grocery-card-top"><h4>{b.name}</h4><span className="grocery-card-amount">{b.total === null ? b.coverage ? cash(b.subtotal, plan.currency) : "—" : cash(b.total, plan.currency)}</span></div><p>{b.coverage}/{b.count} items · {b.total === null ? "Partial subtotal" : b.eligible ? "Estimated complete basket" : "Conditional complete basket"}</p><details className="grocery-card-info"><summary aria-label={`Info ${b.name}`}>Info</summary><BasketInfo basket={b} plan={plan} products={products} /></details></article>;
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
    const state = complete ? basket!.eligible ? "Estimated complete basket" : "Conditional complete basket" : s?.subtotal !== null && s?.subtotal !== undefined ? "Observed partial subtotal" : "Amount unknown";
    return <article className="grocery-basket grocery-store-card" key={g.name}>
      <div className="grocery-card-top"><h3>{g.name === "Fresh St. Market" ? "Fresh St." : g.name}</h3><span className="grocery-card-amount">{amount}</span></div>
      <p className="grocery-card-state">{state}</p>
      {!complete && s && <small>{s.priced}/{items.length} articles chiffrables</small>}
      <p>{s?.known ?? 0}/{items.length} prices · {r ? modeLabels[r.mode ?? "unknown"] : "Purchase method needs review"}</p>
      {r ? <Fees retailer={r} /> : <p className="grocery-fee-line">Fees need review</p>}
      <details className="grocery-card-info"><summary aria-label={"Info " + g.name}>Info</summary>{r ? <>
        <p>{s?.priced ?? 0} priced reference(s), whole packs. Fees, taxes and missing quantities are excluded from the subtotal.</p>
        <p>Alimentation {s?.foodPriced ? cash(s.food, plan.currency) : "non chiffrable"} · Maison {s?.householdPriced ? cash(s.household, plan.currency) : "non chiffrable"}</p>
        <p>{r.locality || "Location needs review"} · {r.areaConfirmed ? "Service area confirmed" : "Service area needs review"} · {r.enabled === false ? "Excluded from comparison" : "Included in comparison"}</p>
        <PriceSource value={r.evidence} />
        {r.minimum === null && <p>Minimum de commande inconnu.</p>}
        <p>Tax, deposits, membership and other fees : {r.otherFeesReviewed ? "see saved amounts" : "needs review"}.</p>
        {!!s!.missing.length && <ul className="grocery-missing">{s!.missing.map(m => <li key={m.name}>{m.name} : {m.reason}</li>)}</ul>}
        {basket && <BasketInfo basket={basket} plan={plan} products={products} />}
        <StoreReceiptProducts plan={plan} products={products} retailerIds={g.retailers.map(r => r.id)} />
        {g.retailers.length > 1 && <><p>Other purchase methods or catalogues, shown separately :</p>{g.retailers.filter(x => x.id !== r.id).map(x => <section className="grocery-product" key={x.id}>
          <strong>{x.name} · {modeLabels[x.mode ?? "unknown"]}</strong><p>{observedSummary(plan, x).known}/{items.length} prices. These amounts are not added to the method above.</p><PriceSource value={x.evidence} />
          {onEdit && <button className="text-action grocery-card-edit" onClick={() => onEdit(x)} aria-label={"Modifier " + x.name + " " + modeLabels[x.mode ?? "unknown"]}>Modifier</button>}
        </section>)}</>}
      </> : <p>No documented reference for this retailer yet. No price or availability is assumed.</p>}</details>
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
  const unitLabel = rate?.basis === "l" ? "Price per litre" : rate?.basis === "kg" ? "Price per kilogram" : rate ? `Price per ${rate.label}` : "Unit price";
  const gap = ranked?.reason || !ranked ? "Not comparable" : ranked.gap === "Lowest observed · 0%" ? "Lowest price" : ranked.gap;
  const tone = ranked?.tone ?? "neutral";
  const adjusted = ranked ? adjustedOfferQuantity(item, ranked) : null;
  const packs = adjusted?.packs ?? offerQuantity(item, p), equivalent = adjusted?.normalized ?? equivalentCost(item, p);
  const state = priceState(p, r);
  const warning = ranked?.reason || (!ranked ? "Reference not ranked" : state !== "Revu" ? state : "");
  const limits = [warning, p.available === "unknown" ? "Stock not confirmed" : "", !r.otherFeesReviewed || r.delivery === null || r.service === null || p.taxPercent === null || p.depositPerPack == null ? "Fees need review" : ""].filter(Boolean);
  return <article className="grocery-offer-card">
    <div className="grocery-offer-header"><h4>{r.name}</h4><span className={`grocery-unit-gap grocery-unit-gap-${tone}`} aria-label={ranked?.reason || ranked?.gap || "Reference not ranked; no comparable percentage"} title="Observed unit prices exclude fees. Check brand, variant and purchase method.">{gap}</span></div>
    <dl className="grocery-offer-fields">
      <div><dt>Brand</dt><dd><strong>{brand || "Not specified"}</strong></dd></div>
      <div><dt>Product</dt><dd>{product || "Not specified"}</dd></div>
      <div><dt>Format</dt><dd>{formatLabel(p, item)}</dd></div>
    </dl>
    <dl className="grocery-offer-prices">
      <div><dt>Pack price</dt><dd>{new Intl.NumberFormat("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(p.price)} {p.currency}</dd></div>
      <div><dt>{unitLabel}</dt><dd>{rate ? formatUnitRate(rate, p.currency).split("/")[0] : "Non calculable"}</dd></div>
    </dl>
    <p className="grocery-offer-context">{modeLabels[p.mode ?? "unknown"]} · {p.locality || "Location unknown"}</p>
    {!!limits.length && <p className="grocery-offer-warning">{[...new Set(limits)].join(" · ")}</p>}
    <details className="grocery-offer-source"><summary>Source and terms <span className="sr-only">— {r.name}, {p.product}, {modeLabels[p.mode ?? "unknown"]}</span><span className="grocery-offer-chevron" aria-hidden="true">›</span></summary>
      <div className="grocery-offer-source-content">
        <PriceSource value={p.evidence} />
        <p>Reference: {p.product}. {ranked?.reason || ranked?.gap || "Reference not ranked"}. {ranked?.reason || !ranked ? "No comparable percentage was calculated." : "Difference from the observed minimum in the same unit and currency, before fees."}</p>
        <p>{modeLabels[p.mode ?? "unknown"]} · {p.locality || "Location unknown"} · {p.localityConfirmed ? "Location confirmed" : "Location not confirmed"} · {p.approved ? "Observation reviewed" : "Observation not approved"} · {p.available === "yes" ? "Stock as shown by the source; confirm before buying" : p.available === "no" ? "Unavailable according to the source" : "Stock not confirmed"}</p>
        <p>{p.matchNote || "Check brand, variant and pack size."}</p>
        {adjusted && <p>Common quantity : {adjustedNumber(adjusted.quantity)} {adjusted.label}. Conversion : {adjustedNumber(adjusted.quantity)} / {adjustedNumber(adjusted.pack)} = {adjustedNumber(adjusted.quantity / adjusted.pack)} proportional pack(s). {adjusted.reference ? "Reference quantity for comparison. Actual need is unchanged." : "Saved basket quantity."} Review candidate pack size.</p>}
        <p>{(!adjusted && quantityReason(item, p)) || (packs === null ? "Amount needed is unknown" : "Purchase of " + Number(packs.toFixed(3)) + " format(s) : " + cash(Math.round(packs * p.price * 100), plan.currency) + ", before fees and taxes.")}{included ? " Reference included in the calculations." : " Reference is not used for a complete basket."}</p>
        {equivalent !== null && <p>{adjusted?.reference ? "Proportional reference amount" : "Proportional equivalent to quantity needed"} : {equivalent > 0 && equivalent < .0001 ? adjustedMoney(equivalent, plan.currency) : `${Number(equivalent.toFixed(4))} ${plan.currency}`}. This amount differs from buying whole packs and does not measure actual consumption.</p>}
        <p>Item taxes : {p.taxPercent === null ? "needs review" : `${p.taxPercent} %`} · Deposit per pack : {p.depositPerPack == null ? "needs review" : `${p.depositPerPack.toFixed(2)} ${p.currency}`}</p>
        <div className="grocery-detail-conditions"><strong>Conditions · {r.name} · {modeLabels[r.mode ?? "unknown"]}</strong><Fees retailer={r} /><p>Free delivery from : {r.freeDeliveryAbove === null ? "needs review" : `${r.freeDeliveryAbove.toFixed(2)} ${plan.currency}`} · Tax on fees : {r.feesTaxPercent === null ? "needs review" : `${r.feesTaxPercent} %`}</p><p>Membership: {r.membershipStatus === "none" ? "none" : r.membershipStatus === "existing" ? "existing" : r.membershipStatus === "proposal" ? "proposal not confirmed" : "needs review"} · Weekly cost : {r.membershipWeekly == null ? "needs review" : `${r.membershipWeekly.toFixed(2)} ${plan.currency}`}. {r.membershipNote}</p><p>{r.locality || "Location needs review"} · {r.areaConfirmed ? "Service area confirmed" : "Service area needs review"} · {r.slots === "yes" ? "Slots per source" : r.slots === "no" ? "No slots per source" : "Check slots"} · {r.otherFeesReviewed ? "Fees reviewed" : "Other fees need review"} · Optional tip : {plan.tipPerOrder.toFixed(2)} {plan.currency}</p><PriceSource value={r.evidence} /></div>
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
    <div className="grocery-article-heading"><h3>{item.name}</h3>{identity ? <span className="grocery-quantity-chip">{format}</span> : <button type="button" className="text-action" aria-label={`Details for ${item.name}`} aria-haspopup="dialog" onClick={() => setDetailsOpen(true)}>Details</button>}</div>
    {identity}
    {identity && showComparison && <div className="grocery-price-headings" aria-hidden="true"><span>Store</span><span>Unit price</span><span>Difference from lowest</span></div>}
    {showComparison && <div className="grocery-price-rows">{unitComparison.rows.map(({ group: g, offers }) => {
      return <div className="grocery-price-row" key={g.name}><strong>{g.name === "Fresh St. Market" ? "Fresh St." : g.name}</strong><div>{offers.length ? offers.map(({ p, rate, reason, gap, tone }) =>
        <div className="grocery-price-option" key={p.id}>
          <span className="grocery-price-value">{identity ? <><strong>{packagePrice(p.price, p.currency)}</strong><small>{!reason && rate ? formatUnitRate(rate, p.currency) : p.available === "no" ? "Unavailable" : !datedPrice(p) ? "Historical" : !p.mode || p.mode === "unknown" ? "Purchase method not confirmed" : "Not comparable"}</small><small>{formatLabel(p, item)}</small></> : !reason && rate ? formatUnitRate(rate, p.currency) : p.available === "no" ? "Unavailable" : !datedPrice(p) ? "Historical" : !p.mode || p.mode === "unknown" ? "Purchase method not confirmed" : "Not comparable"}</span>
          <small className={`grocery-unit-gap grocery-unit-gap-${tone}`} aria-label={gap} title={reason || "Difference from observed minimum in the same unit and currency, before fees"}>{gap === "Lowest observed · 0%" ? "0%" : gap === "Tie · 0%" ? "0% (tie)" : reason ? "-" : gap}</small>
          {identity && <small className="grocery-price-mode">{modeLabels[p.mode ?? "unknown"]}{p.substitution ? " · Substitution" : ""}{!p.approved ? " · Needs review" : ""}{reason ? " · " + reason : ""}</small>}
        </div>) : <div className="grocery-price-option"><span className="grocery-price-value">Price missing</span><small className="grocery-unit-gap grocery-unit-gap-neutral">—</small></div>}</div></div>;
    })}</div>}
    {identity && <div className="grocery-catalogue-card-footer"><span className={needsReview ? "grocery-price-review" : "grocery-price-observed"}>{needsReview ? "Prices need review" : "Observed unit prices"}</span><button type="button" className="text-action grocery-details-action" aria-label={`Details for ${item.name}`} aria-haspopup="dialog" onClick={() => setDetailsOpen(true)}>Details</button></div>}
    <Sheet open={detailsOpen} onClose={() => setDetailsOpen(false)} title="Product details" className="grocery-article-details" resetScrollOnOpen footer={<button type="button" className="button secondary" onClick={() => setDetailsOpen(false)}>Back to prices</button>}>
      <div className="grocery-product-heading"><h3>{item.name}</h3><p>Prices and details by store</p></div>
      {identity}
      {identity && format && <p className="grocery-product-format">Catalogue pack size: {format}</p>}
      <div className="grocery-offer-cards">{unitComparison.rows.map(({ group: g, offers: rankedOffers }) => {
        // Retain older observations and separate modes; only current ranked offers get a gap.
        const offers = g.retailers.flatMap(r => plan.prices.filter(p => p.itemId === item.id && p.retailerId === r.id));
        const ordered = [...rankedOffers.map(o => o.p), ...offers.filter(p => !rankedOffers.some(o => o.p.id === p.id))];
        return ordered.length ? ordered.map(p => <ArticleOfferCard key={p.id} plan={plan} item={item} p={p} r={g.retailers.find(r => r.id === p.retailerId)!} ranked={rankedOffers.find(o => o.p.id === p.id)} included={included.has(p.id)} />)
          : <section className="grocery-offer-card grocery-offer-empty" key={g.name}><h4>{g.name}</h4><p>No documented price for this item yet. This does not mean it is unavailable.</p></section>;
      })}</div>
      <details className="grocery-card-info grocery-comparison-info"><summary>About this comparison</summary>
        <p>Amount needed: {needLabel(item, true)}. {item.provisional ? "Estimated quantity to confirm." : ""}</p>
        <p>Sorted by observed unit price before order fees. Difference = (unit price / comparable minimum − 1) × 100. Purchase method, brand and variant still need review; the ranking does not validate item equivalence or a complete basket.</p>
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
    <section className="grocery-comparison-status" aria-label="Price status">
      <strong>{unitCoverage.count}/{unitCoverage.total} items with comparable unit prices</strong>
      <small>{comparison.best ? "Estimated basket available" : "Complete totals not confirmed"}{comparison.truncated ? " · Calculation limited" : ""}</small>
      <details className="grocery-card-info"><summary>About these amounts</summary>
        <p>{known}/{items.length} items with observed prices · {comparison.coverage}/{items.length} references verified for the total.</p>
        <p>Unit prices can be compared without a basket quantity. Common totals use known values or a shared reference quantity. Each selected store must still have a compatible price.</p>
        <p>An observed price is a candidate until the product, pack size, location and purchase method are reviewed. Partial subtotals cover priced references only, excluding unconfirmed fees and taxes.</p>
        <p>Whole-pack purchases are rounded. Proportional amounts do not measure stock or actual consumption.</p>
        {comparison.best && <p>Lowest estimate among complete options : {comparison.best.name}, {cash(comparison.best.total!, plan.currency)}. Confirm before buying.</p>}
      </details>
    </section>
    <GroceryCommonBasket plan={plan} products={products} renderConditions={store => <StoreCards plan={plan} comparison={comparison} products={products} onlyStore={store} />} />
    <div><h3>Price by item</h3></div>{!items.length && <p className="grocery-empty">There are no items in this basket.</p>}
    {items.map(item => <ArticleComparison key={item.id} plan={plan} item={item} groups={groups} products={products} />)}
    {!!comparison.split.length && <details className="grocery-info"><summary>Split baskets</summary><div className="grocery-store-grid">{comparison.split.map(b => <CompactBasket key={b.key} basket={b} plan={plan} products={products} />)}</div></details>}
  </>;
}
