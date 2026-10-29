import { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { GroceryRecord, GroceryItem } from "../../../worker/src/grocery-model";
import { emptyPlan, modeLabels, type GroceryPlan } from "../../../worker/src/grocery-planning";
import type { WorkerConfig } from "../types";
import { groceryRequest } from "../grocery-api";
import { groceryCache } from "../grocery-cache";
import { purchaseAmountLabel, purchaseDate, purchaseStatus, purchaseLineBlockers, purchaseSourceSummary, recentPcExpressPurchases } from "../grocery-purchases";
import { purchaseScenarioStores } from "../grocery-purchase-scenarios";
import { validatePurchaseResolution, type PurchaseResolution } from "../../../worker/src/grocery-purchase-resolution";
import { estimatedSourceLine } from "../../../worker/src/grocery-purchase-evidence";
import { packagePrice } from "../grocery-price-display";
import { grocerySourceLink } from "../grocery-source-link";
import { Sheet } from "../ui/primitives";
import GroceryPurchaseResolution from "./GroceryPurchaseResolution";
import GroceryPurchaseScenario from "./GroceryPurchaseScenario";
import GroceryReferenceLeads from "./GroceryReferenceLeads";

const money = (n: number | null, currency: string | null) => n === null || !currency ? "Montant inconnu" : packagePrice(n, currency);
const dateLabel = (date: string | null) => date ? new Intl.DateTimeFormat("fr-CA", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(date + "T12:00:00Z")) : "Date inconnue";
const sourceFormat = (line: GroceryItem) => `${line.quantity ?? "?"} × ${line.size ?? "?"} ${line.unit === "each" ? "unités" : line.unit || "format inconnu"}`;
export default function GroceryPurchases({ config, records, onReview }: { config: WorkerConfig; records: GroceryRecord[]; onReview: (r: GroceryRecord) => void }) {
  const [plan, setPlan] = useState<GroceryPlan>(emptyPlan), [selected, setSelected] = useState<string | null>(null), [status, setStatus] = useState("Lecture des prix.");
  const opener = useRef<HTMLButtonElement | null>(null);
  const dialogEntry = useRef<string | null>(null), dialogUrl = useRef<string | null>(null), closing = useRef(false), afterClose = useRef<(() => void) | null>(null);
  useEffect(() => {
    const onBack = (event: PopStateEvent) => { if (dialogEntry.current && history.state?.familyhubPurchaseDialog !== dialogEntry.current) { if (location.href === dialogUrl.current) event.stopImmediatePropagation(); finishClose(); } };
    // A modal-only Back must not remount the underlying route and discard its focus target.
    window.addEventListener("popstate", onBack, true);
    return () => { window.removeEventListener("popstate", onBack, true); if (dialogEntry.current && history.state?.familyhubPurchaseDialog === dialogEntry.current) { const state = { ...history.state }; delete state.familyhubPurchaseDialog; history.replaceState(state, ""); } };
  }, []);
  const [resolution, setResolution] = useState<PurchaseResolution>(), [resolutionStatus, setResolutionStatus] = useState("");
  const [resolutionAvailable, setResolutionAvailable] = useState(false), [resolutionBusy, setResolutionBusy] = useState(false), [resolutionMessage, setResolutionMessage] = useState("");
  const [refresh, setRefresh] = useState(0), decisionLock = useRef(false);
  const scope = config.Endpoint.trim().replace(/\/$/, "") || "unpaired";
  const context = scope + "\n" + config.ApiKey, currentContext = useRef(context); currentContext.current = context;
  useEffect(() => { setPlan(emptyPlan()); if (dialogEntry.current) requestClose(); else setSelected(null); setResolution(undefined); setResolutionMessage(""); }, [scope, config.ApiKey]);
  useEffect(() => {
    let active = true; setStatus("Lecture des prix.");
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
  }, [scope, config.ApiKey, records, refresh]);
  useEffect(() => {
    let active = true; setResolutionAvailable(false); setResolutionStatus("Lecture des candidats et confirmations.");
    void (async () => {
      try { const saved = await groceryCache<unknown>(scope + ":purchase-resolution"); if (saved && active) setResolution(validatePurchaseResolution(saved)); } catch { /* A failed cache never prevents a fresh PC read. */ }
      if (!config.Endpoint || !config.ApiKey) { if (active) setResolutionStatus("Appairez le PC pour lire et confirmer les candidats."); return; }
      try {
        const health = await groceryRequest<{ capabilities?: string[] }>(config, "/health");
        if (!active) return;
        if (!health.capabilities?.includes("grocery-purchase-resolution-v1")) { setResolutionStatus("Mettez à jour le worker PC pour confirmer un format sans modifier le ticket."); return; }
        const next = validatePurchaseResolution(await groceryRequest(config, "/groceries/purchase-resolution"));
        if (!active) return; setResolution(next); setResolutionAvailable(true); setResolutionStatus("");
        try { await groceryCache(scope + ":purchase-resolution", next); } catch { if (active) setResolutionStatus("Confirmations lues sur le PC ; cache indisponible sur cet appareil."); }
      } catch { if (active) setResolutionStatus("Candidats et confirmations non vérifiables. Reconnectez le PC puis actualisez le comparatif ; aucune confirmation n'est présumée absente."); }
    })();
    return () => { active = false; };
  }, [scope, config.ApiKey, records, refresh]);
  async function decide(id: string, action: "confirm" | "unconfirm") {
    if (!resolution || !resolutionAvailable || decisionLock.current) return;
    const requestContext = context; decisionLock.current = true; setResolutionBusy(true); setResolutionMessage("");
    try {
      const next = validatePurchaseResolution(await groceryRequest(config, "/groceries/purchase-resolution", { action, id, expectedRevision: resolution.revision, ...(action === "confirm" ? { confirmed: true } : {}) }));
      if (currentContext.current !== requestContext) return;
      setResolution(next); setResolutionMessage(action === "confirm" ? "Produit et format confirmés pour cette ligne. Ticket inchangé ; seuls les prix admissibles sont calculés." : "Confirmation retirée. Le ticket et la preuve candidate restent conservés.");
      try { await groceryCache(scope + ":purchase-resolution", next); } catch { if (currentContext.current === requestContext) setResolutionMessage("Décision enregistrée sur le PC ; cache indisponible sur cet appareil."); }
    } catch (e) { if (currentContext.current === requestContext) { setResolutionAvailable(false); setResolutionMessage((e as Error).message + " Actualisez le comparatif avant de réessayer."); } }
    finally { decisionLock.current = false; setResolutionBusy(false); }
  }
  const active = records.filter(r => !r.duplicateOf).sort((a, b) => (purchaseDate(b) || b.createdAt).localeCompare(purchaseDate(a) || a.createdAt));
  const recent = recentPcExpressPurchases(active), recentIds = new Set(recent.map(r => r.id)), archived = active.filter(r => !recentIds.has(r.id));
  const record = active.find(r => r.id === selected), comparisons = record ? purchaseScenarioStores(plan, record, undefined, resolution, records) : [];
  const sourceSummary = record ? purchaseSourceSummary(plan, record) : null;
  function finishClose() { dialogEntry.current = null; dialogUrl.current = null; closing.current = false; setSelected(null); const next = afterClose.current; afterClose.current = null; requestAnimationFrame(() => { if (opener.current?.isConnected) opener.current.focus(); next?.(); }); }
  function requestClose(next?: () => void) { if (closing.current) return; afterClose.current = next ?? null; closing.current = true; if (dialogEntry.current && history.state?.familyhubPurchaseDialog === dialogEntry.current) history.back(); else finishClose(); }
  function close() { requestClose(); }
  function openDetails(id: string, trigger: HTMLButtonElement) { if (closing.current) return; opener.current = trigger; dialogUrl.current = location.href; dialogEntry.current = crypto.randomUUID(); history.pushState({ ...history.state, familyhubPurchaseDialog: dialogEntry.current }, "", location.href); setSelected(id); }
  function totals(r: GroceryRecord, compact = false) {
    return purchaseScenarioStores(plan, r, undefined, resolution, records).map(store => <div className="grocery-purchase-store" key={store.name}>
      <div className="grocery-purchase-store-heading"><span>{store.name}</span><strong>{store.normalized === null ? "Indisponible" : money(store.normalized, r.receipt.currency)}</strong></div>
      {compact ? <small>{!store.complete ? "Partiel " : ""}{store.covered}/{store.count} · dont {store.estimated} estimé{store.estimated > 1 ? "s" : ""}{store.nonlocal ? " · Non local" : store.historical ? " · Ancien" : ""}</small> : <>
      <small><strong>{store.estimated ? "Scénario estimé au prorata" : store.complete ? "Comparaison vérifiée" : "Comparatif incomplet"}</strong></small>
      <small>{store.covered}/{store.count} comparés, dont {store.estimated} estimé{store.estimated > 1 ? "s" : ""} · {store.verified} vérifiés{!store.complete ? " · sous-total partiel" : ""}</small>
      {store.estimated > 0 && <small>Paquets entiers : {store.outlay === null ? "coût à préciser" : `${store.packEstimated ? "exemple estimé " : "scénario "}${money(store.outlay, r.receipt.currency)}`}. {store.limited ? "Prix anciens, non locaux ou conditions à vérifier dans le détail." : "Hypothèses et substitutions détaillées par produit."}</small>}
      {store.comparisonOnly && !store.estimated && <small>Prix observés le {store.observationDates.join(", ")} · équivalents de même format, identité SKU et marque non garanties.</small>}
      {store.sourceEstimate !== null && store.normalized !== null && <small>Sur ces mêmes articles : source estimée {money(store.sourceEstimate, r.receipt.currency)} · écart observé {money(Math.round((store.sourceEstimate - store.normalized) * 100) / 100, r.receipt.currency)}. Hors frais et taxes ; pas une économie de commande.</small>}
      {store.multiContext && <p className="grocery-purchase-detail-note">Prix relevés dans différents magasins ou canaux : estimation, sans panier local unique confirmé.</p>}
      </>}
    </div>);
  }
  function cards(rows: GroceryRecord[], archive = false) {
    return <div className="grocery-purchase-cards">{rows.map(r => <article className="grocery-purchase-card" key={r.id}>
      <button className="grocery-purchase-open" onClick={event => { openDetails(r.id, event.currentTarget); }} aria-label={`Ouvrir l'achat ${r.receipt.store || "à vérifier"} du ${purchaseDate(r) || "date inconnue"}`}>
        <div className="grocery-purchase-heading"><div className="grocery-purchase-brand"><span className="grocery-purchase-logo" aria-hidden="true">{archive ? "Achat" : "PCX"}</span><div><strong>{archive ? r.receipt.store || "Magasin à vérifier" : "PC Express"}</strong><span>{dateLabel(purchaseDate(r))}</span></div></div><ChevronRight size={18} aria-hidden="true" /></div>
        <div className="grocery-purchase-amount"><span>{purchaseAmountLabel(r)}</span><strong>{money(r.receipt.total, r.receipt.currency)}</strong></div>
      </button>
      <div className="grocery-purchase-totals" aria-label={`Comparatif de l'achat chez ${r.receipt.store}`}><p>Comparaison au prorata</p>{totals(r, true)}<small className="grocery-purchase-cost-note">Coût équivalent · hors frais et taxes</small></div>
      <button className="grocery-purchase-more" onClick={event => { openDetails(r.id, event.currentTarget); }} aria-label={`Plus d’infos pour l’achat du ${purchaseDate(r) || "date inconnue"}`}>Plus d’infos<ChevronRight size={15} aria-hidden="true" /></button>
    </article>)}</div>;
  }
  return <section className="view-stack grocery-purchases" aria-label="Achats et comparaisons" data-purchase-dialog-url={record ? dialogUrl.current ?? undefined : undefined}>
    <p className="grocery-purchase-intro">PC Express · achats des 30 derniers jours</p>
    {status && <p role="status">{status}</p>}
    {resolutionStatus && <p role="status">{resolutionStatus}</p>}
    <button type="button" className="button secondary" disabled={!config.Endpoint || !config.ApiKey || resolutionBusy} onClick={() => { setResolutionMessage(""); setRefresh(n => n + 1); }}>Actualiser le comparatif</button>
    {!recent.length && <p className="grocery-empty">Aucun achat PC Express terminé et vérifié dans les 30 derniers jours. Les commandes sans preuve de livraison et les autres tickets restent dans les archives. Relisez le PC ou ajoutez les sources dans Sources et outils.</p>}
    {cards(recent)}
    <details className="grocery-purchase-archives"><summary>Archives et autres tickets <span>{archived.length}</span></summary>{archived.length ? cards(archived, true) : <p>Aucun autre ticket conservé.</p>}</details>
    <Sheet open={Boolean(record)} onClose={close} title={record ? `Achat du ${dateLabel(purchaseDate(record))}` : "Achat"} description={record?.receipt.store || "Articles et prix concurrents datés"} className="grocery-purchase-sheet" resetScrollOnOpen wide footer={<button className="button secondary" onClick={close}>Retour aux achats</button>}>
      {record && <div className="grocery-purchase-detail">
        {resolutionMessage && <p className="grocery-resolution-message" role="status">{resolutionMessage}</p>}
        {resolutionStatus && <p role="status">{resolutionStatus}</p>}
        {!resolutionAvailable && <button type="button" className="button secondary" disabled={resolutionBusy} onClick={() => { setResolutionMessage(""); setRefresh(n => n + 1); }}>Actualiser le comparatif</button>}
        <div className="grocery-purchase-summary"><span>{purchaseAmountLabel(record)}</span><strong>{money(record.receipt.total, record.receipt.currency)}</strong></div>
        <div className="grocery-purchase-totals" aria-label="Couverture actuelle du comparatif">{totals(record)}</div>
        {sourceSummary?.subtotal !== null && sourceSummary?.subtotal !== undefined && <p className="grocery-source-estimate-summary">Somme des articles estimés : {money(sourceSummary.subtotal, record.receipt.currency)} · {sourceSummary.covered}/{sourceSummary.count} lignes. {sourceSummary.difference !== null && Math.abs(sourceSummary.difference) > .005 && <>Écart de {money(sourceSummary.difference, record.receipt.currency)} avec le total source : taxes, frais ou ajustements à rapprocher. Total source conservé.</>}</p>}
        <h3>Comparaison par produit</h3><p className="grocery-purchase-detail-note">Vérifié ou estimé, ligne par ligne. Les hypothèses, différences de produit et prix historiques restent visibles. Les montants sont hors taxes, frais et déplacement.</p>
        {record.receipt.items.map((line, index) => { const derived = comparisons.map(c => c.lines[index].comparisonEvidence).find(Boolean), format = comparisons.map(c => c.lines[index].formatEvidence).find(Boolean), sourceQuote = estimatedSourceLine(plan.sourceEstimates, record, index), blockers = purchaseLineBlockers(plan, record, index, resolution).filter(reason => !comparisons.some(store => store.lines[index].confidence === "estimated" && reason.startsWith(store.name + ":"))); return <article className="grocery-purchase-line" key={index}>
          <div className="grocery-purchase-product-heading"><h4>{line.product || line.name || `Ligne ${index + 1}`}</h4><p>Quantité de la source : {sourceFormat(line)}{line.uncertain ? " · à vérifier" : ""}</p></div>
          {derived && <p>Comparaison seulement : {derived.quantity} x {derived.formatLabel} · format dérivé, source brute conservée.</p>}
          {format && <p>Format dérivé confirmé : {format.formatLabel}. {format.formatBasis === "household-assumption" ? "Calcul fondé sur le renseignement du foyer, non sur un poids officiel." : "Confirmation propre à cet achat."} Source brute conservée.</p>}
          {blockers.length > 0 && <><p className="grocery-purchase-detail-note">Informations non vérifiées — le scénario peut les estimer :</p><ul className="grocery-resolution-blockers" aria-label="Informations à compléter">{blockers.map(reason => <li key={reason}>{reason}</li>)}</ul></>}
          <GroceryPurchaseResolution record={record} index={index} state={resolution} available={resolutionAvailable} busy={resolutionBusy} error={resolutionAvailable ? "" : resolutionMessage} canRefresh={!!config.Endpoint && !!config.ApiKey} onRefresh={() => { setResolutionMessage(""); setRefresh(n => n + 1); }} onDecision={decide} onReview={() => { requestClose(() => onReview(record)); }} />
          <div className="grocery-purchase-match grocery-source-price"><div><strong>{record.receipt.store || "Achat d'origine"}</strong><small>{sourceQuote ? `Quantité ${sourceQuote.quantity} × prix unitaire estimé ${money(sourceQuote.unitPrice, sourceQuote.currency)}` : derived ? "Prix source estimé · paiement inconnu" : `${sourceFormat(line)} · prix historique`}</small></div><strong>{money(sourceQuote?.amount ?? derived?.sourceEstimate ?? line.amount, record.receipt.currency)}{(sourceQuote || derived) && <small>estimé · paiement inconnu</small>}</strong></div>
          {comparisons.map(store => {
            const match = store.lines[index], p = match.price, item = p && plan.items.find(i => i.id === p.itemId);
            return <div className="grocery-purchase-match" key={store.name}><div><strong>{store.name}</strong><small>{match.scenario ? `Tarif ${match.scenario.referenceSize} ${match.scenario.referenceUnit} · observé le ${p?.evidence.date}` : match.comparisonEvidence ? `${match.comparisonEvidence.referenceFormatLabel} · équivalent, observé le ${p?.evidence.date}` : p ? `${p.size} ${p.unit === "each" ? item?.countUnit || "unités" : p.unit}` : "Référence manquante"}</small>{match.confidence === "estimated" && <small>{match.scenario?.relation === "estimated-substitution" ? "Substitution estimée" : "Estimation"}{(match.scenario?.ageDays ?? 0) > 7 ? ` · prix âgé de ${match.scenario!.ageDays} jours` : ""}</small>}</div><div className="grocery-purchase-price">{!match.reason && <span className="grocery-calculated">{match.confidence === "estimated" ? "Estimé" : "Vérifié"}</span>}{!match.reason && match.calculated && <span className="grocery-calculated">Calculé</span>}<strong>{match.reason ? "Indisponible" : money(match.normalized, record.receipt.currency)}</strong></div></div>;
          })}
          <details><summary>Formats, calcul et sources</summary><p>Source d'achat : {line.evidence || "Preuve manquante"}</p>{sourceQuote && <p>{sourceQuote.quantity} × {money(sourceQuote.unitPrice, sourceQuote.currency)} = {money(sourceQuote.amount, sourceQuote.currency)} estimés. {sourceQuote.sourceEvidence} Revu le {sourceQuote.reviewedAt}. Aucun prix catalogue actuel ni paiement final déduit.</p>}{derived && <><p>{derived.provenance}</p><p>{derived.sourceEstimateEvidence}</p><p>Équivalent de même format pour comparer, sans identité SKU ou marque garantie, sans autorisation de remplacement du panier. Revu le {derived.reviewedAt}.</p></>}{comparisons.map(store => {
            const match = store.lines[index], p = match.price, link = p && grocerySourceLink(p.evidence.url);
            if (match.scenario && p) return <GroceryPurchaseScenario key={store.name} scenario={match.scenario} price={p} store={store.name} onSourceReceipt={id => { const source = records.find(r => r.id === id); if (source) { requestClose(() => onReview(source)); } }} />;
            return <section className="grocery-purchase-evidence" key={store.name}><strong>{store.name}</strong>{match.reason && <p>{match.reason} · montant exclu du comparatif.</p>}{p && <><p>{p.product} · {p.size} {p.unit} · {money(p.price, p.currency)} le format, observé le {p.evidence.date || "date inconnue"}.</p>{!match.reason && <><p>{money(p.price, p.currency)} × {Number((match.ratio! * p.size).toFixed(6))}/{p.size} = {money(match.normalized, p.currency)} pour la quantité de la source.</p><p>{p.weighed ? "Quantité au poids" : `${match.packs} paquet(s) entier(s)`} : {money(match.outlay, p.currency)} avant taxes et frais.</p></>}<p>{p.matchNote} · {p.locality} · {modeLabels[p.mode || "unknown"]}. {p.evidence.until ? `Valable jusqu'au ${p.evidence.until}.` : "Validité à reconfirmer."} Disponibilité à revérifier avant achat.</p>{link && <a href={link.href} target="_blank" rel="noreferrer">{link.label}</a>}</>}</section>;
          })}<GroceryReferenceLeads state={resolution} product={line.product || line.name} /></details>
        </article>; })}
        <details className="grocery-purchase-provenance"><summary>Provenance de l’achat et limites</summary><p>{purchaseStatus(record)}</p><p>Montant de la source avec ses propres frais, taxes et remises. Il n'est pas comparé aux seuls produits concurrents pour annoncer une économie.</p>{record.receipt.fulfillment && <p>Livraison du {dateLabel(record.receipt.fulfillment.date)} : {record.receipt.fulfillment.evidence}</p>}<p>Source originale : {record.receipt.date || "date inconnue"} · référence {record.receipt.reference || "inconnue"}.</p>{record.receipt.warnings.map((w, i) => <p key={i}>{w}</p>)}<div className="grocery-purchase-totals">{totals(record)}</div>{comparisons.map(store => <p key={store.name}>{store.name} : {store.covered}/{store.count} comparés, dont {store.estimated} estimé{store.estimated > 1 ? "s" : ""}. {store.outlay === null ? "Coût des paquets entiers non chiffré." : `${store.estimated ? "Scénario de paquets entiers" : "Formats achetables"} : ${money(store.outlay, record.receipt.currency)}, hors taxes et frais.`}</p>)}<button className="text-action" onClick={() => { requestClose(() => onReview(record)); }}>Voir les sources et vérifier le ticket</button></details>
      </div>}
    </Sheet>
  </section>;
}
