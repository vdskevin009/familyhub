import type { GroceryPlan } from "../../../worker/src/grocery-planning";
import type { ReceiptProduct } from "../grocery-receipt-products";
export function ArticleReceiptProducts({ itemId, products }: { itemId: string; products: ReceiptProduct[] }) {
  const matches = products.filter(p => p.itemId === itemId);
  if (!matches.length) return null;
  return <section className="grocery-receipt-products"><h4>Marques / produits retrouvés sur ticket</h4>
    {matches.map(p => <div key={p.product}><strong>{p.product}</strong><p className="grocery-evidence">Ticket : {p.store || "magasin inconnu"} · {p.date || "date inconnue"}</p></div>)}
    <p>Achat historique du produit identifié. La marque et la variante de l’offre comparée restent à confirmer dans sa propre source.</p>
  </section>;
}
export function StoreReceiptProducts({ plan, products, retailerIds }: { plan: GroceryPlan; products: ReceiptProduct[]; retailerIds: string[] }) {
  const items = plan.items.filter(i => i.active && products.some(p => p.itemId === i.id) && plan.prices.some(p => p.itemId === i.id && retailerIds.includes(p.retailerId)));
  if (!items.length) return null;
  return <details className="grocery-card-info grocery-store-receipt-products"><summary>Marques retrouvées sur ticket</summary>
    <p>Références d’achat pour les articles ayant une offre dans ce magasin, y compris les articles exclus du total. Le ticket peut provenir d’un autre magasin ou d’une autre localité.</p>
    {items.map(i => <div className="grocery-product" key={i.id}><strong>{i.name}</strong><ArticleReceiptProducts itemId={i.id} products={products} /></div>)}
  </details>;
}
