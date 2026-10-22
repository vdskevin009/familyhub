import { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { GroceryRecord, GroceryItem } from "../../../worker/src/grocery-model";
import { emptyPlan, modeLabels, type GroceryPlan } from "../../../worker/src/grocery-planning";
import type { WorkerConfig } from "../types";
import { groceryRequest } from "../grocery-api";
import { groceryCache } from "../grocery-cache";
import { purchaseAmountLabel, purchaseDate, purchaseStatus, purchaseStoreComparisons, recentPcExpressPurchases } from "../grocery-purchases";
import { packagePrice } from "../grocery-price-display";
import { grocerySourceLink } from "../grocery-source-link";
import { Sheet } from "../ui/primitives";

const money = (n: number | null, currency: string | null) => n === null || !currency ? "Montant inconnu" : packagePrice(n, currency);
const dateLabel = (date: string | null) => date ? new Intl.DateTimeFormat("fr-CA", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(date + "T12:00:00Z")) : "Date inconnue";
const sourceFormat = (line: GroceryItem) => `${line.quantity ?? "?"} × ${line.size ?? "?"} ${line.unit === "each" ? "unités" : line.unit || "format inconnu"}`;
export default function GroceryPurchases({ config, records, onReview }: { config: WorkerConfig; records: GroceryRecord[]; onReview: (r: GroceryRecord) => void }) {
  const [plan, setPlan] = useState<GroceryPlan>(emptyPlan), [selected, setSelected] = useState<string | null>(null), [status, setStatus] = useState("Lecture des prix.");
  const opener = useRef<HTMLButtonElement | null>(null);
  const scope = config.Endpoint.trim().replace(/\/$/, "") || "unpaired";
  useEffect(() => {
    let active = true; setPlan(emptyPlan()); setSelected(null); setStatus("Lecture des prix.");
    void (async () => {
      try {
        const cached = await groceryCache<GroceryPlan>(scope + ":purchase-comparison");
        if (!active) return;
        if (cached) setPlan(cached);
        if (!config.Endpoint || !config.ApiKey) { setStatus("Appairez le PC pour lire les prix locaux. Aucun prix inventé."); return; }
        try {
          const next = await groceryRequest<GroceryPlan>(config, "/groceries/planning");
          if (!active) return; setPlan(next); setStatus(""); await groceryCache(scope + ":purchase-comparison", next);
        } catch { if (active) setStatus("Prix PC indisponibles. Les prix en cache restent datés ; actualisez avec le PC connecté."); }
      } catch { if (active) setStatus("Cache de comparaison indisponible. Relisez le PC."); }
    })();
    return () => { active = false; };
  }, [scope, config.ApiKey, records]);
  const active = records.filter(r => !r.duplicateOf).sort((a, b) => (purchaseDate(b) || b.createdAt).localeCompare(purchaseDate(a) || a.createdAt));
  const recent = recentPcExpressPurchases(active), recentIds = new Set(recent.map(r => r.id)), archived = active.filter(r => !recentIds.has(r.id));
  const record = active.find(r => r.id === selected), comparisons = record ? purchaseStoreComparisons(plan, record) : [];
  function close() { setSelected(null); requestAnimationFrame(() => { if (opener.current?.isConnected) opener.current.focus(); }); }
  function totals(r: GroceryRecord) {
    return purchaseStoreComparisons(plan, r).map(store => <div className="grocery-purchase-store" key={store.name}>
      <div className="grocery-purchase-store-heading"><span>{store.name}</span>{store.complete ? <strong>{money(store.normalized, r.receipt.currency)}</strong> : <span className="grocery-purchase-unavailable">Comparatif incomplet</span>}</div>
      {!store.complete && <small>{store.covered}/{store.count} articles{store.normalized !== null ? ` · sous-total partiel ${money(store.normalized, r.receipt.currency)}` : " · prix ou correspondances à compléter"}</small>}
    </div>);
  }
  function cards(rows: GroceryRecord[], archive = false) {
    return <div className="grocery-purchase-cards">{rows.map(r => <article className="grocery-purchase-card" key={r.id}>
      <button className="grocery-purchase-open" onClick={event => { opener.current = event.currentTarget; setSelected(r.id); }} aria-label={`Ouvrir l'achat ${r.receipt.store || "à vérifier"} du ${purchaseDate(r) || "date inconnue"}`}>
        <div className="grocery-purchase-heading"><div className="grocery-purchase-brand"><span className="grocery-purchase-logo" aria-hidden="true">{archive ? "Achat" : "PCX"}</span><div><strong>{archive ? r.receipt.store || "Magasin à vérifier" : "PC Express"}</strong><span>{dateLabel(purchaseDate(r))}</span></div></div><ChevronRight size={18} aria-hidden="true" /></div>
        <div className="grocery-purchase-amount"><span>{purchaseAmountLabel(r)}</span><strong>{money(r.receipt.total, r.receipt.currency)}</strong></div>
      </button>
      <div className="grocery-purchase-totals" aria-label={`Comparatif de l'achat chez ${r.receipt.store}`}><p>Le même panier ailleurs</p>{totals(r)}<small>Produits seuls, mêmes quantités · hors taxes et frais.</small></div>
      <button className="grocery-purchase-more" onClick={event => { opener.current = event.currentTarget; setSelected(r.id); }} aria-label={`Voir les produits de l'achat du ${purchaseDate(r) || "date inconnue"}`}>Voir les produits et comparaisons<ChevronRight size={15} aria-hidden="true" /></button>
    </article>)}</div>;
  }
  return <section className="view-stack grocery-purchases" aria-label="Achats et comparaisons">
    <p className="grocery-purchase-intro">PC Express · achats des 30 derniers jours</p>
    {status && <p role="status">{status}</p>}
    {!recent.length && <p className="grocery-empty">Aucun achat PC Express terminé et vérifié dans les 30 derniers jours. Les commandes sans preuve de livraison et les autres tickets restent dans les archives. Relisez le PC ou ajoutez les sources dans Sources et outils.</p>}
    {cards(recent)}
    <details className="grocery-purchase-archives"><summary>Archives et autres tickets <span>{archived.length}</span></summary>{archived.length ? cards(archived, true) : <p>Aucun autre ticket conservé.</p>}</details>
    <Sheet open={Boolean(record)} onClose={close} title={record ? `Achat du ${dateLabel(purchaseDate(record))}` : "Achat"} description={record?.receipt.store || "Articles et prix concurrents datés"} className="grocery-purchase-sheet" resetScrollOnOpen wide footer={<button className="button secondary" onClick={close}>Retour aux achats</button>}>
      {record && <div className="grocery-purchase-detail">
        <div className="grocery-purchase-summary"><span>{purchaseAmountLabel(record)}</span><strong>{money(record.receipt.total, record.receipt.currency)}</strong></div>
        <h3>Comparaison par produit</h3><p className="grocery-purchase-detail-note">Mêmes quantités · prix concurrents hors taxes et frais. Le format réel de chaque magasin reste affiché.</p>
        {record.receipt.items.map((line, index) => <article className="grocery-purchase-line" key={index}>
          <div className="grocery-purchase-product-heading"><h4>{line.product || line.name || `Ligne ${index + 1}`}</h4><p>Quantité de la source : {sourceFormat(line)}{line.uncertain ? " · à vérifier" : ""}</p></div>
          <div className="grocery-purchase-match"><div><strong>{record.receipt.store || "Achat d'origine"}</strong><small>{sourceFormat(line)} · prix historique</small></div><strong>{money(line.amount, record.receipt.currency)}</strong></div>
          {comparisons.map(store => {
            const match = store.lines[index], p = match.price, item = p && plan.items.find(i => i.id === p.itemId);
            return <div className="grocery-purchase-match" key={store.name}><div><strong>{store.name}</strong><small>{p ? `${p.size} ${p.unit === "each" ? item?.countUnit || "unités" : p.unit}` : "Référence manquante"}</small></div><div className="grocery-purchase-price">{!match.reason && match.calculated && <span className="grocery-calculated">Calculé</span>}<strong>{match.reason ? "À compléter" : money(match.normalized, record.receipt.currency)}</strong></div></div>;
          })}
          <details><summary>Formats, calcul et sources</summary><p>Source d'achat : {line.evidence || "Preuve manquante"}</p>{comparisons.map(store => {
            const match = store.lines[index], p = match.price, link = p && grocerySourceLink(p.evidence.url);
            return <section className="grocery-purchase-evidence" key={store.name}><strong>{store.name}</strong>{match.reason && <p>{match.reason} · montant exclu du comparatif.</p>}{p && <><p>{p.product} · {p.size} {p.unit} · {money(p.price, p.currency)} le format, observé le {p.evidence.date || "date inconnue"}.</p>{!match.reason && <><p>{money(p.price, p.currency)} × {Number((match.ratio! * p.size).toFixed(6))}/{p.size} = {money(match.normalized, p.currency)} pour la quantité de la source.</p><p>{p.weighed ? "Quantité au poids" : `${match.packs} paquet(s) entier(s)`} : {money(match.outlay, p.currency)} avant taxes et frais.</p></>}<p>{p.matchNote} · {p.locality} · {modeLabels[p.mode || "unknown"]}. {p.evidence.until ? `Valable jusqu'au ${p.evidence.until}.` : "Validité à reconfirmer."} Disponibilité à revérifier avant achat.</p>{link && <a href={link.href} target="_blank" rel="noreferrer">{link.label}</a>}</>}</section>;
          })}</details>
        </article>)}
        <details className="grocery-purchase-provenance"><summary>Provenance de l’achat et limites</summary><p>{purchaseStatus(record)}</p><p>Montant de la source avec ses propres frais, taxes et remises. Il n'est pas comparé aux seuls produits concurrents pour annoncer une économie.</p>{record.receipt.fulfillment && <p>Livraison du {dateLabel(record.receipt.fulfillment.date)} : {record.receipt.fulfillment.evidence}</p>}<p>Source originale : {record.receipt.date || "date inconnue"} · référence {record.receipt.reference || "inconnue"}.</p>{record.receipt.warnings.map((w, i) => <p key={i}>{w}</p>)}<div className="grocery-purchase-totals">{totals(record)}</div>{comparisons.map(store => <p key={store.name}>{store.name} : {store.covered}/{store.count} articles. {store.outlay === null ? "Formats achetables non chiffrés." : `Formats achetables : ${money(store.outlay, record.receipt.currency)}, hors taxes et frais.`}</p>)}<button className="text-action" onClick={() => { setSelected(null); requestAnimationFrame(() => { opener.current?.focus(); onReview(record); }); }}>Voir les sources et vérifier le ticket</button></details>
      </div>}
    </Sheet>
  </section>;
}
