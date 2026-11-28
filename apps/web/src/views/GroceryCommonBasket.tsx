import { useId, useState, type ReactNode } from "react";
import { modeLabels, type GroceryPlan } from "../../../worker/src/grocery-planning";
import { adjustedMoney, adjustedNumber, commonQuantityComparison } from "../grocery-common-quantity";
import { formatUnitRate } from "../grocery-unit-comparison";
import { Sheet } from "../ui/primitives";
import { grocerySourceLink } from "../grocery-source-link";
import { storeGroups } from "../grocery-comparison";
import type { ReceiptProduct } from "../grocery-receipt-products";
import { ArticleReceiptProducts, StoreReceiptProducts } from "./GroceryReceiptProducts";

export default function GroceryCommonBasket({ plan, renderConditions, products = [] }: { plan: GroceryPlan; renderConditions: (store: string) => ReactNode; products?: ReceiptProduct[] }) {
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
    <p className="grocery-common-note">Common basis: {common.count}/{common.total} items in the total{common.count < common.total ? " · Partial" : ""} · Excludes fees · Review proportional estimate{modes.length > 1 ? " · Mixed purchase methods" : ""}</p>
    {common.referenceCount > 0 && <p className="grocery-common-note">{common.referenceCount} item(s) use a common reference quantity. This comparison basket differs from your actual basket.</p>}
    <details className="grocery-card-info"><summary>Choisir les magasins du total</summary>
      <p>Comparing fewer stores may increase coverage. Item prices remain visible for all stores.</p>
      <fieldset className="grocery-total-stores"><legend>Magasins du total</legend>{choices.map(g => <label key={g.name}><input type="checkbox" checked={(chosen ?? baseline.participantNames).includes(g.name)} onChange={e => { const current = chosen ?? baseline.participantNames; setSelectedStores(e.target.checked ? [...current, g.name] : current.filter(name => name !== g.name)); }} />{g.name}</label>)}</fieldset>
      <button type="button" className="text-action" onClick={() => setSelectedStores(undefined)}>Reset stores</button>
    </details>
    <div className="grocery-price-rows grocery-common-rows">{common.stores.filter(s => s.group.retailers.length || ["Fresh St. Market", "Walmart", "Costco", "Superstore"].includes(s.group.name)).map((s, index) => {
      const storeModes = [...new Set(s.lines.map(l => l.offer.p.mode ?? "unknown"))];
      return <button type="button" className="grocery-price-row grocery-common-row" key={s.group.name} aria-label={`Basket details for ${s.group.name}`} aria-haspopup="dialog" aria-describedby={`${id}-store-${index} ${id}-price-${index}`} onClick={() => setSelected(s.group.name)}>
        <span className="grocery-common-store" id={`${id}-store-${index}`}><strong>{s.group.name === "Fresh St. Market" ? "Fresh St." : s.group.name}</strong><small>{storeModes.length > 1 ? "Mixed purchase methods" : storeModes.length ? modeLabels[storeModes[0]] : "Purchase method needs review"}</small></span>
        <span className="grocery-common-price" id={`${id}-price-${index}`}><strong className="grocery-price-value">{s.amount === null ? "—" : amount(s.amount)}</strong><small className={`grocery-unit-gap grocery-unit-gap-${s.percent === 0 ? "minimum" : s.percent !== null ? "higher" : "neutral"}`}>{s.gap}</small></span>
        <span className="grocery-common-details" aria-hidden="true">Details</span>
      </button>;
    })}</div>
    {common.participants === 0 && <p>Choisissez au moins un magasin pour calculer le total.</p>}
    </section>
    <Sheet resetScrollOnOpen open={!!store} onClose={() => setSelected(null)} title={`Basket details for ${selected || ""}`} className="grocery-article-details grocery-basket-details" footer={<button type="button" className="button secondary" onClick={() => setSelected(null)}>Back to prices</button>}>
      {store && <>
        <div className="grocery-basket-total">
          <div><span>Total proportionnel</span><strong>{store.amount === null ? "Inconnu" : amount(store.amount)}</strong></div>
          <small>{common.count}/{common.total} items{common.count < common.total ? " · Partial basis" : ""} · {store.gap}</small>
          <small>Excludes fees, taxes et consignes{modes.length > 1 ? " · Mixed purchase methods" : ""}</small>
          <small>{store.lines.length && store.lines.every(l => l.offer.p.approved) ? "Prices reviewed" : "Prices need review"} · Stock not confirmed</small>
          {common.referenceCount > 0 && <small>{common.referenceCount} reference quantity or quantities · not the actual basket</small>}
        </div>
        <div className="grocery-basket-lines" aria-label="Articles du total proportionnel">
          {store.lines.map(l => { const source = l.offer.p.evidence, link = grocerySourceLink(source.url); return <details className="grocery-basket-line" key={l.item.id}>
            <summary className="grocery-basket-line-summary">
              <span className="grocery-basket-line-name"><strong>{l.item.name}</strong><small>{number(l.quantity)} {l.label}{l.reference ? " · Reference" : ""}</small></span>
              <span className="grocery-basket-line-price"><strong>{amount(l.normalized)}</strong><small>Proportionnel</small></span>
              <span className="grocery-basket-line-chevron" aria-hidden="true">⌄</span>
            </summary>
            <div className="grocery-basket-line-detail">
              <small>Item offered by this store</small><strong>{l.offer.p.product}</strong>
              <ArticleReceiptProducts itemId={l.item.id} products={products} />
              <p><strong>Achat {l.offer.p.weighed ? "au poids" : "en paquets entiers"} : {amount(l.purchase)}</strong> · {number(l.packs)} format(s) de {number(l.pack)} {l.label}. Excludes fees, taxes et consignes.</p>
              <p>{modeLabels[l.offer.p.mode ?? "unknown"]} · {l.offer.p.locality || "Location unknown"} · {l.offer.p.approved ? "Observation reviewed" : "Observation not approved"} · {l.offer.p.available === "yes" ? "Stock as shown by the source; confirm before buying" : "Stock not confirmed"}</p>
              <p>{l.selection} {l.reference ? "Reference quantity for comparison. Actual need is unchanged." : l.item.provisional ? "Provisional need to confirm." : "Saved basket quantity."}</p>
              <p>Format : {number(l.pack)} {l.label} · {amount(l.offer.p.price)}. Conversion : {number(l.quantity)} / {number(l.pack)} = {number(l.quantity / l.pack)} proportional pack(s) · {formatUnitRate(l.offer.rate!, plan.currency)}. Normalised amount: {amount(l.normalized)}. Buying extra does not measure consumption.</p>
              <p className="grocery-evidence">{source.title || "Source needed"} · {source.date || "Date unknown"} · {source.until ? `until ${source.until}` : "Validity needs checking"}{link && <a className="grocery-source-action" href={link.href} target="_blank" rel="noopener noreferrer">{link.label}<span className="sr-only"> {source.title || "Source"} (new tab)</span></a>}</p>
            </div>
          </details>; })}
        </div>
        <StoreReceiptProducts plan={plan} products={products} retailerIds={store.group.retailers.map(r => r.id)} />
        <details className="grocery-card-info"><summary>Calculation details</summary><p>Same basis of {common.count}/{common.total} items at the same quantities across {common.participants} stores. Difference = (normalised amount / minimum on the same basis − 1) × 100. Reference quantities compare equivalent amounts without changing the actual basket. The proportional total is not the cost of whole packs. Products, brands, variants, location, stock and purchase methods still need review. Conversions stay within the same dimension; no unknown weight, density or dose is inferred.</p></details>
        {!!common.excluded.length && <details className="grocery-card-info"><summary>Excluded items ({common.excluded.length})</summary><ul>{common.exclusionDetails.map(({ item, reason }) => <li key={item.id}>{item.name} : {reason}</li>)}</ul><p>Each item needs a compatible reference at every selected store. Partial coverage does not establish a complete basket or a saving after fees.</p></details>}
        <details className="grocery-card-info"><summary>Conditions and saved purchases</summary>{renderConditions(store.group.name)}</details>
      </>}
    </Sheet>
  </>;
}
