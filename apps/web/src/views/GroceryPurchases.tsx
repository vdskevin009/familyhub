import { useEffect, useRef, useState } from "react";
import type { GroceryRecord } from "../../../worker/src/grocery-model";
import { emptyPlan, modeLabels, type GroceryPlan } from "../../../worker/src/grocery-planning";
import type { WorkerConfig } from "../types";
import { groceryRequest } from "../grocery-api";
import { groceryCache } from "../grocery-cache";
import { purchaseComparison, purchaseStatus } from "../grocery-purchases";
import { packagePrice } from "../grocery-price-display";
import { grocerySourceLink } from "../grocery-source-link";
import { Sheet } from "../ui/primitives";

const money = (n: number | null, currency: string | null) => n === null || !currency ? "Montant inconnu" : packagePrice(n, currency);
export default function GroceryPurchases({ config, records, onReview }: { config: WorkerConfig; records: GroceryRecord[]; onReview: (r: GroceryRecord) => void }) {
  const [plan, setPlan] = useState<GroceryPlan>(emptyPlan), [selected, setSelected] = useState<string | null>(null), [status, setStatus] = useState("Lecture des prix…");
  const opener = useRef<HTMLButtonElement | null>(null);
  const scope = config.Endpoint.trim().replace(/\/$/, "") || "unpaired";
  useEffect(() => {
    let active = true; setPlan(emptyPlan()); setSelected(null); setStatus("Lecture des prix…");
    void (async () => {
      try {
        const cached = await groceryCache<GroceryPlan>(scope + ":purchase-comparison");
        if (!active) return;
        if (cached) setPlan(cached);
        if (!config.Endpoint || !config.ApiKey) { setStatus("Appairez le PC pour lire les prix locaux. Aucun prix inventé."); return; }
        try {
          const next = await groceryRequest<GroceryPlan>(config, "/groceries/planning");
          if (!active) return; setPlan(next); setStatus(""); await groceryCache(scope + ":purchase-comparison", next);
        } catch { if (active) setStatus("Prix PC indisponibles. Les éventuels prix en cache restent datés ; actualisez avec le PC connecté."); }
      } catch { if (active) setStatus("Cache de comparaison indisponible. Relisez le PC."); }
    })();
    return () => { active = false; };
  }, [scope, config.ApiKey, records]);
  const active = records.filter(r => !r.duplicateOf).sort((a, b) => (b.receipt.date || b.createdAt).localeCompare(a.receipt.date || a.createdAt));
  const record = active.find(r => r.id === selected);
  const comparisons = record ? purchaseComparison(plan, record) : [];
  function totals(r: GroceryRecord) {
    return purchaseComparison(plan, r).map(store => <div className="grocery-purchase-total" key={store.retailer.id}>
      <div className="grocery-purchase-store-heading"><strong>{store.retailer.name}</strong><strong>{store.normalized === null ? "—" : money(store.normalized, r.receipt.currency)}</strong></div>
      {"mode" in store.retailer && <small>{modeLabels[store.retailer.mode || "unknown"]} · {store.retailer.locality || "Localité inconnue"}</small>}
      <small>{store.covered}/{store.count} lignes · {store.complete ? "produits comparables" : "comparatif partiel"} · hors taxes et frais</small>
      {store.outlay !== null && <small>Formats achetables : {money(store.outlay, r.receipt.currency)} avant taxes et frais</small>}
      {!store.complete && <small>Total du panier indisponible</small>}
    </div>);
  }
  return <section className="view-stack" aria-label="Achats et comparaisons">
    <p>Ouvrez un achat pour comparer les mêmes quantités. Prix concurrents datés, hors taxes et frais.</p>
    {status && <p role="status">{status}</p>}
    {!active.length && <p className="grocery-empty">Aucun achat conservé sur cet appareil. Importez un ticket ci-dessous, puis vérifiez ses sources.</p>}
    <div className="grocery-purchase-cards">{active.map(r => <article className="grocery-purchase-card" key={r.id}>
      <button className="grocery-purchase-open" onClick={event => { opener.current = event.currentTarget; setSelected(r.id); }} aria-label={`Ouvrir l'achat ${r.receipt.store || "à vérifier"} du ${r.receipt.date || "date inconnue"}`}><strong>{r.receipt.store || "Magasin à vérifier"}</strong><span>{r.receipt.date || "Date inconnue"}</span><strong>{money(r.receipt.total, r.receipt.currency)}</strong><span>{purchaseStatus(r)}</span><small>{r.status === "draft" ? "Brouillon · exclu des dépenses" : "Source enregistrée"} · {r.receipt.items.length} lignes</small><span className="text-action">Voir les articles et comparaisons</span></button>
      <div className="grocery-purchase-totals" aria-label={`Comparatif de l'achat chez ${r.receipt.store}`}>{totals(r)}</div>
    </article>)}</div>
    <Sheet open={Boolean(record)} onClose={() => setSelected(null)} title={record ? `Achat chez ${record.receipt.store || "magasin inconnu"}` : "Achat"} description="Articles de la source et prix concurrents datés" wide>
      {record && <div className="view-stack grocery-purchase-detail"><p>{record.receipt.date || "Date inconnue"} · {purchaseStatus(record)}</p><h3>{money(record.receipt.total, record.receipt.currency)}</h3>
        <p>Montant de la source, avec ses propres taxes, frais et remises. Aucune économie calculée en comparant ce total aux produits seuls.</p>
        {record.receipt.warnings.map((w, i) => <p className="grocery-warning" key={i}>{w}</p>)}
        <button className="button secondary" onClick={() => { setSelected(null); requestAnimationFrame(() => { if (opener.current?.isConnected) { opener.current.focus(); onReview(record); } }); }}>Voir les sources et vérifier le ticket</button>
        <h3>Comparatif par magasin</h3><div className="grocery-purchase-totals">{totals(record)}</div>
        <p>Coût comparable pour la quantité achetée, avant taxes et frais. Une fraction de paquet sert uniquement au calcul ; les formats achetables sont arrondis au paquet supérieur. Les produits au poids restent proportionnels. Aucun total final avec livraison, taxes, consignes ou conditions de fidélité n'est supposé.</p>
        <h3>Articles de la source</h3>{record.receipt.items.map((line, index) => <article className="grocery-purchase-line" key={index}><h4>{line.product || line.name || `Ligne ${index + 1}`}</h4><p>{line.quantity ?? "?"} × {line.size ?? "?"} {line.unit === "each" ? "unités" : line.unit || "format inconnu"} · {money(line.amount, record.receipt.currency)} sur la source{line.uncertain ? " · à vérifier" : ""}</p>
          <details><summary>Preuve de la ligne</summary><p>{line.evidence || "Preuve manquante"}</p></details>
          {comparisons.map(store => {
            const match = store.lines[index], p = match.price, link = p && grocerySourceLink(p.evidence.url);
            const item = p && plan.items.find(i => i.id === p.itemId);
            return <div className="grocery-purchase-match" key={store.retailer.id}><strong>{store.retailer.name}</strong>
              {match.reason ? <><p>{match.reason} · montant non comparé</p>{p && <details><summary>Référence exclue du calcul</summary><p>{p.product} · {p.size} {p.unit} · {money(p.price, p.currency)} le {p.evidence.date || "date inconnue"}</p><p>{p.matchNote}</p>{link && <a href={link.href} target="_blank" rel="noreferrer">{link.label}</a>}</details>}</> : p && <><p>{p.product} · {p.size} {p.unit === "each" ? item?.countUnit || "unités" : p.unit}</p><p><strong>{money(match.normalized, p.currency)}</strong>{match.calculated && <span className="grocery-calculated">Calculé</span>}</p>
                <details><summary>Détails du prix et du calcul</summary><p>Prix du format en rayon : {money(p.price, p.currency)} pour {p.size} {p.unit === "each" ? item?.countUnit || "unités" : p.unit}.</p><p>{money(p.price, p.currency)} × {Number((line.quantity! * line.size! * (line.unit === "g" || line.unit === "ml" ? .001 : 1)).toFixed(6))}/{Number((p.size * (p.unit === "g" || p.unit === "ml" ? .001 : 1)).toFixed(6))} = {money(match.normalized, p.currency)} pour la quantité de la source.</p><p>{p.weighed ? "Quantité au poids" : `${match.packs} paquet(s) entier(s)`} : {money(match.outlay, p.currency)} avant taxes et frais. {p.taxPercent === null ? "Taxe produit inconnue." : `Taxe produit déclarée : ${p.taxPercent} % (non incluse ici).`} {p.depositPerPack == null ? "Consigne à vérifier." : `Consigne par format : ${money(p.depositPerPack, p.currency)} (non incluse).`}</p><p>{p.substitution ? "Alternative comparable revue" : "Même produit revu"} · {p.matchNote}</p><p>Source du {p.evidence.date}{p.evidence.until ? `, valable jusqu'au ${p.evidence.until}` : ", validité à reconfirmer"} · {p.locality} · {modeLabels[p.mode || "unknown"]}. Disponibilité observée, à revérifier avant achat.</p>{link && <a href={link.href} target="_blank" rel="noreferrer">{link.label}</a>}</details></>}
            </div>;
          })}</article>)}
      </div>}
    </Sheet>
  </section>;
}
