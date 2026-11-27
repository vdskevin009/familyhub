import type { GroceryPlan } from "../../../worker/src/grocery-planning";
import type { ReceiptProduct } from "../grocery-receipt-products";
export function ArticleReceiptProducts({ itemId, products }: { itemId: string; products: ReceiptProduct[] }) {
  const matches = products.filter(p => p.itemId === itemId);
  if (!matches.length) return null;
  return <section className="grocery-receipt-products"><h4>Brands and products found on receipts</h4>
    {matches.map(p => <div key={p.product}><strong>{p.product}</strong><p className="grocery-evidence">Ticket : {p.store || "magasin inconnu"} · {p.date || "date unknown"}</p></div>)}
    <p>Historical purchase of the identified product. Confirm the compared offer’s brand and variant against its own source.</p>
  </section>;
}
export function StoreReceiptProducts({ plan, products, retailerIds }: { plan: GroceryPlan; products: ReceiptProduct[]; retailerIds: string[] }) {
  const items = plan.items.filter(i => i.active && products.some(p => p.itemId === i.id) && plan.prices.some(p => p.itemId === i.id && retailerIds.includes(p.retailerId)));
  if (!items.length) return null;
  return <details className="grocery-card-info grocery-store-receipt-products"><summary>Brands found on receipts</summary>
    <p>Purchase references for items with an offer at this store, including items excluded from the total. A receipt may be from a different store or location.</p>
    {items.map(i => <div className="grocery-product" key={i.id}><strong>{i.name}</strong><ArticleReceiptProducts itemId={i.id} products={products} /></div>)}
  </details>;
}
