import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import type { WorkerConfig } from "../types";
import { Notice } from "../ui/primitives";
import { groceryRequest, loadGroceries } from "../grocery-api";
import { groceryCache } from "../grocery-cache";
import { emptyPlan, type GroceryPlan } from "../../../worker/src/grocery-planning";
import type { GroceryRecord } from "../../../worker/src/grocery-model";
import { cadenceLabel } from "../../../worker/src/grocery-weekly";
import { storeGroups } from "../grocery-comparison";
import { receiptProducts } from "../grocery-receipt-products";
import { currentCart, filterCatalogue, householdCatalogue, parseCartSnapshot, validateCataloguePlan, type CatalogueArticle, type PCExpressCartSnapshot } from "../grocery-catalogue";
import GroceryTargetView from "./GroceryTargetView";
import { ArticleComparison } from "./GroceryComparison";

function Identity({ row }: { row: CatalogueArticle }) {
  const identities = row.identities.length ? row.identities : [{ product: row.item.name, brand: null, size: row.item.size, unit: row.item.unit, source: "Liste du foyer", date: null }];
  const render = (p: typeof identities[number], i: number) => <p key={i}><span>{p.product !== row.item.name ? p.product + " · " : ""}{p.brand || "Marque inconnue"}</span>{i > 0 && <span>{p.size !== null && p.unit ? p.size + " " + (p.unit === "each" ? "unité(s)" : p.unit) : "Format inconnu"}</span>}</p>;
  return <div className="grocery-catalogue-identity">{render(identities[0], 0)}{identities.length > 1 && <details><summary>Autres produits observés ({identities.length - 1})</summary>{identities.slice(1).map(render)}</details>}</div>;
}
function catalogueFormat(row: CatalogueArticle) {
  const identity = row.identities[0];
  const size = identity ? identity.size : row.item.size, unit = identity ? identity.unit : row.item.unit;
  return size !== null && unit ? size + " " + (unit === "each" ? "unité(s)" : unit) : "Format inconnu";
}
export default function GroceryCatalogueView({ config, view, onManage }: { config: WorkerConfig; view: "catalogue" | "target"; onManage: () => void }) {
  const [plan, setPlan] = useState<GroceryPlan>(emptyPlan), [records, setRecords] = useState<GroceryRecord[]>([]);
  const [snapshot, setSnapshot] = useState<PCExpressCartSnapshot | null>(null), [scope, setScope] = useState<"all" | "cart">("all");
  const [showComparison, setShowComparison] = useState(false), [search, setSearch] = useState("");
  const [ready, setReady] = useState(false), [error, setError] = useState(""), [refresh, setRefresh] = useState(0);
  const paired = Boolean(config.Endpoint.trim() && config.ApiKey.trim());
  const cacheKey = (config.Endpoint.trim().replace(/\/$/, "") || "unpaired") + ":pcexpress-cart-snapshot-v1";
  useEffect(() => { setPlan(emptyPlan()); setRecords([]); setSnapshot(null); }, [cacheKey, config.ApiKey]);
  useEffect(() => {
    let active = true; setReady(false); setError("");
    void (async () => {
      try {
        try { const cart = await groceryCache<unknown>(cacheKey); if (cart && active) setSnapshot(parseCartSnapshot(cart)); }
        catch { if (active) setError("Snapshot PCExpress illisible. Importez une nouvelle capture ; les besoins restent conservés."); }
        if (paired) {
          const [p, receipts] = await Promise.allSettled([groceryRequest<GroceryPlan>(config, "/groceries/planning"), loadGroceries(config)]);
          if (!active) return;
          if (receipts.status === "fulfilled") setRecords(receipts.value.records);
          if (p.status === "fulfilled") setPlan(validateCataloguePlan(p.value));
          const failures = [p, receipts].filter(r => r.status === "rejected");
          if (failures.length) setError("Certaines sources PC sont indisponibles. Le catalogue peut être incomplet ; relisez le PC.");
        }
      } catch (e) { if (active) setError((e as Error).message); }
      finally { if (active) setReady(true); }
    })();
    return () => { active = false; };
  }, [cacheKey, config.ApiKey, refresh, paired]);
  const rows = useMemo(() => householdCatalogue(plan, records, snapshot), [plan, records, snapshot]);
  const visible = filterCatalogue(rows, scope, search, snapshot);
  const groups = storeGroups(plan), products = receiptProducts(plan, records);
  const cartIsCurrent = currentCart(snapshot);
  async function importSnapshot(file: File | undefined) {
    if (!file) return;
    try {
      if (file.size > 500000) throw new Error("Snapshot trop volumineux (500 Ko maximum).");
      const parsed = parseCartSnapshot(JSON.parse(await file.text()));
      await groceryCache(cacheKey, parsed); setSnapshot(parsed); setError("");
    } catch (e) { setError((e as Error).message); }
  }
  const scopeControl = <fieldset className="grocery-scope-control"><legend className="sr-only">Afficher</legend>{([['all', 'Tous les produits'], ['cart', 'Panier actuel']] as const).map(([value, label]) => <label key={value}><input className="sr-only" type="radio" name="grocery-catalogue-scope" value={value} checked={scope === value} onChange={() => setScope(value)} /><span>{label}</span></label>)}</fieldset>;
  const searchControl = <label className="grocery-search-field"><span className="sr-only">Rechercher un article</span><Search size={18} aria-hidden="true" /><input type="search" placeholder="Rechercher un article" value={search} onChange={e => setSearch(e.target.value)} /></label>;
  const count = ready ? visible.length + ' produit' + (visible.length > 1 ? 's' : '') + (scope === 'cart' && cartIsCurrent ? ' dans le snapshot PCExpress' : '') : 'Lecture du catalogue…';
  return <section className="view-stack grocery-catalogue">
    {error && <Notice error onDismiss={() => setError('')}>{error}</Notice>}
    <h2 className="grocery-screen-title">{view === 'catalogue' ? 'Catalogue articles' : 'Moins cher'}</h2>
    {!paired && <p className="grocery-warning">Appairez le PC dans les réglages pour lire les besoins et tickets du foyer.</p>}
    {view === 'catalogue' ? <>
      {searchControl}{scopeControl}
      <div className="grocery-comparison-control"><span>Comparaisons</span><button type="button" role="switch" aria-label="Comparaisons" aria-checked={showComparison} onClick={() => setShowComparison(v => !v)}><span className="grocery-switch-track"><span /></span></button><p className="grocery-catalogue-count" role="status">{count}</p></div>
      {ready && !visible.length && <p className="grocery-empty">Aucun article pour ces filtres.{scope === 'all' && !search ? ' Ajoutez les besoins du foyer ou relisez les tickets après achats.' : ''}</p>}
      <div className="grocery-catalogue-cards">{visible.map(row => <div key={row.item.id} className="grocery-catalogue-article"><ArticleComparison plan={plan} item={row.item} groups={groups} products={products} showComparison={showComparison} identity={<Identity row={row} />} format={catalogueFormat(row)} /><details className="grocery-catalogue-history"><summary>Historique et fréquence <span className="sr-only">de {row.item.name}</span></summary><p>{row.item.cadence && row.item.cadence !== 'unknown' ? cadenceLabel(row.item) : 'Fréquence inconnue : aucun rythme déduit des achats.'}</p>{row.identities.map((p, i) => <p key={i}>{p.product} · {p.source} · {p.date || 'Date inconnue'}</p>)}</details></div>)}</div>
    </> : <GroceryTargetView plan={plan} items={visible.map(row => row.item)} ready={ready} controls={<>{searchControl}{scopeControl}</>} />}
    {scope === 'cart' && !cartIsCurrent && <p className="grocery-warning">{snapshot ? "Snapshot ancien, incomplet ou daté dans le futur : le panier actuel n'est pas confirmé." : 'Panier PCExpress indisponible. Importez un snapshot du panier réellement observé.'}</p>}
    <details className="grocery-info grocery-catalogue-tools"><summary>Sources et outils</summary>
      <p>Le catalogue conserve tous les besoins enregistrés et les produits confirmés des tickets. Les fréquences confirmées restent inchangées ; les autres restent inconnues sans achats datés. Le panier PCExpress est un instantané séparé, valable ici pendant 24 h ; ce n'est ni une proposition hebdomadaire ni un stock.</p>
      {snapshot && <p>PCExpress : {snapshot.items.length} référence(s), relevé le {new Date(snapshot.capturedAt).toLocaleString("fr-CA")}. {snapshot.complete ? "Capture complète déclarée." : "Capture partielle."}</p>}
      <label>Importer le snapshot PCExpress privé<input type="file" accept=".json,application/json" onChange={e => { void importSnapshot(e.target.files?.[0]); e.target.value = ""; }} /></label>
      <p>Ce fichier reste sur cet appareil, séparé du plan PC. L'import ne modifie pas PCExpress.</p>
      <button type="button" className="button secondary" aria-label="Relire le catalogue PC" disabled={!paired || !ready} onClick={() => setRefresh(n => n + 1)}><RefreshCw size={16} aria-hidden="true" />Relire le catalogue PC</button>
      <button className="button secondary" onClick={onManage}>Gérer les besoins et prix</button>
      {snapshot && <button className="text-action" onClick={() => { void groceryCache(cacheKey, null).then(() => setSnapshot(null)).catch(e => setError(e.message)); }}>Retirer le snapshot de cet appareil</button>}
      <p>Comparaisons : prix unitaires observés, avant frais de commande. Marques, qualité, disponibilité et modes restent à vérifier dans les fiches.</p>
    </details>
  </section>;
}
