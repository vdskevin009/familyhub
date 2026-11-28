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

const money = (n: number | null, currency: string | null) => n === null || !currency ? "Amount unknown" : packagePrice(n, currency);
const dateLabel = (date: string | null) => date ? new Intl.DateTimeFormat("en-CA", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(date + "T12:00:00Z")) : "Date unknown";
const sourceFormat = (line: GroceryItem) => `${line.quantity ?? "?"} × ${line.size ?? "?"} ${line.unit === "each" ? "units" : line.unit || "unknown pack size"}`;
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
        if (!config.Endpoint || !config.ApiKey) { setStatus("Pair the PC to load local prices. Missing prices are not estimated here."); return; }
        try {
          const next = await groceryRequest<GroceryPlan>(config, "/groceries/planning");
          if (!active) return; setPlan(next); setStatus(""); await groceryCache(scope + ":purchase-comparison", next);
        } catch { if (active) setStatus("PC prices are unavailable. Cached prices retain their dates; refresh when the PC is connected."); }
      } catch { if (active) setStatus("Cached comparison unavailable. Refresh from the PC."); }
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
        if (!health.capabilities?.includes("grocery-purchase-resolution-v1")) { setResolutionStatus("Update the PC worker to confirm a pack size without changing the receipt."); return; }
        const next = validatePurchaseResolution(await groceryRequest(config, "/groceries/purchase-resolution"));
        if (!active) return; setResolution(next); setResolutionAvailable(true); setResolutionStatus("");
        try { await groceryCache(scope + ":purchase-resolution", next); } catch { if (active) setResolutionStatus("Confirmations loaded from the PC. This device could not update its cache."); }
      } catch { if (active) setResolutionStatus("Candidates and confirmations could not be verified. Reconnect to the PC and refresh the comparison; existing confirmations may still be present."); }
    })();
    return () => { active = false; };
  }, [scope, config.ApiKey, records, refresh]);
  async function decide(id: string, action: "confirm" | "unconfirm") {
    if (!resolution || !resolutionAvailable || decisionLock.current) return;
    const requestContext = context; decisionLock.current = true; setResolutionBusy(true); setResolutionMessage("");
    try {
      const next = validatePurchaseResolution(await groceryRequest(config, "/groceries/purchase-resolution", { action, id, expectedRevision: resolution.revision, ...(action === "confirm" ? { confirmed: true } : {}) }));
      if (currentContext.current !== requestContext) return;
      setResolution(next); setResolutionMessage(action === "confirm" ? "Item and pack size confirmed for this line. The receipt is unchanged; only eligible prices are calculated." : "Confirmation removed. The receipt and candidate evidence are retained.");
      try { await groceryCache(scope + ":purchase-resolution", next); } catch { if (currentContext.current === requestContext) setResolutionMessage("Decision saved on the PC. This device could not update its cache."); }
    } catch (e) { if (currentContext.current === requestContext) { setResolutionAvailable(false); setResolutionMessage((e as Error).message + "  Refresh the comparison before trying again."); } }
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
      <div className="grocery-purchase-store-heading"><span>{store.name}</span><strong>{store.normalized === null ? "Unavailable" : !store.complete ? "Incomplete basket" : money(store.normalized, r.receipt.currency)}</strong></div>
      {store.normalized !== null && !store.complete && <small><strong>Subtotal for only {store.covered} item{store.covered > 1 ? "s" : ""}: {money(store.normalized, r.receipt.currency)}</strong> · {store.missing} without prices</small>}
      {compact ? <small>{!store.complete ? "Partial " : ""}{store.covered}/{store.count} · including {store.estimated} estimated{store.nonlocal ? " · Non-local" : store.historical ? "  · Historical" : ""}</small> : <>
      <small><strong>{store.estimated ? "Estimated prorated scenario" : store.complete ? "Verified comparison" : "Incomplete comparison"}</strong></small>
      <small>{store.covered}/{store.count} compared, including {store.estimated} estimated · {store.verified} verified{!store.complete ? " · partial subtotal" : ""}</small>
      {store.normalized !== null && <small>Whole packs: {store.outlay === null ? "cost unknown" : `${store.packEstimated ? "estimated example" : "scenario "}${money(store.outlay, r.receipt.currency)}`}. {store.limited ? "See details for historical prices, non-local prices or conditions that need checking." : "See each item for assumptions and substitutions."}</small>}
      {store.observationDates.length > 0 && <small>Observed prices: {store.observationDates.join(", ")}.</small>}
      {!store.complete && store.missingProducts.length > 0 && <p className="grocery-purchase-detail-note">No prices for: {store.missingProducts.join(", ")}. No amount is included for these items.</p>}
      {store.comparisonOnly && !store.estimated && <small>Prices observed on {store.observationDates.join(", ")} · comparable pack sizes; SKU and brand may differ.</small>}
      {store.sourceEstimate !== null && store.normalized !== null && <small>For the same items: source {r.receipt.sourceType === "final-receipt" ? "recorded" : "estimated"} {money(store.sourceEstimate, r.receipt.currency)} · observed difference {money(Math.round((store.sourceEstimate - store.normalized) * 100) / 100, r.receipt.currency)}. Excludes fees and taxes. This is not an order saving.</small>}
      {store.multiContext && <p className="grocery-purchase-detail-note">Prices are from different stores or channels. No single local basket was confirmed.</p>}
      </>}
    </div>);
  }
  function cards(rows: GroceryRecord[], archive = false) {
    return <div className="grocery-purchase-cards">{rows.map(r => <article className="grocery-purchase-card" key={r.id}>
      <button className="grocery-purchase-open" onClick={event => { openDetails(r.id, event.currentTarget); }} aria-label={`Open purchase from ${r.receipt.store || "unverified store"} on ${purchaseDate(r) || "unknown date"}`}>
        <div className="grocery-purchase-heading"><div className="grocery-purchase-brand"><span className="grocery-purchase-logo" aria-hidden="true">{archive ? "Purchase" : "PCX"}</span><div><strong>{archive ? r.receipt.store || "Unverified store" : "PC Express"}</strong><span>{dateLabel(purchaseDate(r))}</span></div></div><ChevronRight size={18} aria-hidden="true" /></div>
        <div className="grocery-purchase-amount"><span>{purchaseAmountLabel(r)}</span><strong>{money(r.receipt.total, r.receipt.currency)}</strong></div>
      </button>
      <div className="grocery-purchase-totals" aria-label={`Purchase comparison for ${r.receipt.store}`}><p>Comparison for equivalent quantities</p>{totals(r, true)}<small className="grocery-purchase-cost-note">Subtotals for priced items only · excludes fees and taxes</small></div>
      <button className="grocery-purchase-more" onClick={event => { openDetails(r.id, event.currentTarget); }} aria-label={`More details for purchase on ${purchaseDate(r) || "unknown date"}`}>More details<ChevronRight size={15} aria-hidden="true" /></button>
    </article>)}</div>;
  }
  return <section className="view-stack grocery-purchases" aria-label="Purchases and comparisons" data-purchase-dialog-url={record ? dialogUrl.current ?? undefined : undefined}>
    <p className="grocery-purchase-intro">PC Express · purchases in the last 30 days</p>
    {status && <p role="status">{status}</p>}
    {resolutionStatus && <p role="status">{resolutionStatus}</p>}
    <button type="button" className="button secondary" disabled={!config.Endpoint || !config.ApiKey || resolutionBusy} onClick={() => { setResolutionMessage(""); setRefresh(n => n + 1); }}>Refresh comparison</button>
    {!recent.length && <p className="grocery-empty">No completed, verified PC Express purchases in the last 30 days. Orders without delivery evidence and other receipts are in the archive. Refresh from the PC or add sources under Sources and tools.</p>}
    {cards(recent)}
    <details className="grocery-purchase-archives"><summary>Archive and other receipts <span>{archived.length}</span></summary>{archived.length ? cards(archived, true) : <p>No other receipts saved.</p>}</details>
    <Sheet open={Boolean(record)} onClose={close} title={record ? `Purchase on ${dateLabel(purchaseDate(record))}` : "Purchase"} description={record?.receipt.store || "Items and dated competitor prices"} className="grocery-purchase-sheet" resetScrollOnOpen wide footer={<button className="button secondary" onClick={close}>Back to purchases</button>}>
      {record && <div className="grocery-purchase-detail">
        {resolutionMessage && <p className="grocery-resolution-message" role="status">{resolutionMessage}</p>}
        {resolutionStatus && <p role="status">{resolutionStatus}</p>}
        {!resolutionAvailable && <button type="button" className="button secondary" disabled={resolutionBusy} onClick={() => { setResolutionMessage(""); setRefresh(n => n + 1); }}>Refresh comparison</button>}
        <div className="grocery-purchase-summary"><span>{purchaseAmountLabel(record)}</span><strong>{money(record.receipt.total, record.receipt.currency)}</strong></div>
        <div className="grocery-purchase-totals" aria-label="Current comparison coverage">{totals(record)}</div>
        {sourceSummary?.subtotal !== null && sourceSummary?.subtotal !== undefined && <p className="grocery-source-estimate-summary">Estimated item subtotal: {money(sourceSummary.subtotal, record.receipt.currency)} · {sourceSummary.covered}/{sourceSummary.count} line items. {sourceSummary.difference !== null && Math.abs(sourceSummary.difference) > .005 && <>Difference of {money(sourceSummary.difference, record.receipt.currency)} from the source total: check taxes, fees and adjustments. The source total is retained.</>}</p>}
        <h3>Compare by item</h3><p className="grocery-purchase-detail-note">Each line is verified or estimated. Assumptions, product differences and historical prices are shown. Amounts exclude taxes, fees and travel.</p>
        {record.receipt.items.map((line, index) => { const derived = comparisons.map(c => c.lines[index].comparisonEvidence).find(Boolean), format = comparisons.map(c => c.lines[index].formatEvidence).find(Boolean), sourceQuote = estimatedSourceLine(plan.sourceEstimates, record, index), blockers = purchaseLineBlockers(plan, record, index, resolution).filter(reason => !comparisons.some(store => store.lines[index].confidence === "estimated" && reason.startsWith(store.name + ":"))); return <article className="grocery-purchase-line" key={index}>
          <div className="grocery-purchase-product-heading"><h4>{line.product || line.name || `Line ${index + 1}`}</h4><p>Source quantity: {sourceFormat(line)}{line.uncertain ? " · needs review" : ""}</p></div>
          {derived && <p>For comparison only: {derived.quantity} x {derived.formatLabel} · derived pack size; original source retained.</p>}
          {format && <p>Confirmed derived pack size: {format.formatLabel}. {format.formatBasis === "household-assumption" ? "Calculation uses household information, not an official weight." : "Confirmation applies to this purchase only."} Original source retained.</p>}
          {blockers.length > 0 && <><p className="grocery-purchase-detail-note">Unverified information that the scenario may estimate:</p><ul className="grocery-resolution-blockers" aria-label="Missing information">{blockers.map(reason => <li key={reason}>{reason}</li>)}</ul></>}
          <GroceryPurchaseResolution record={record} index={index} state={resolution} available={resolutionAvailable} busy={resolutionBusy} error={resolutionAvailable ? "" : resolutionMessage} canRefresh={!!config.Endpoint && !!config.ApiKey} onRefresh={() => { setResolutionMessage(""); setRefresh(n => n + 1); }} onDecision={decide} onReview={() => { requestClose(() => onReview(record)); }} />
          <div className="grocery-purchase-match grocery-source-price"><div><strong>{record.receipt.store || "Original purchase"}</strong><small>{sourceQuote ? `Quantity ${sourceQuote.quantity} × estimated unit price ${money(sourceQuote.unitPrice, sourceQuote.currency)}` : derived ? "Estimated source price · payment unknown" : `${sourceFormat(line)} · historical price`}</small></div><strong>{money(sourceQuote?.amount ?? derived?.sourceEstimate ?? line.amount, record.receipt.currency)}{(sourceQuote || derived) && <small>estimated · payment unknown</small>}</strong></div>
          {comparisons.map(store => {
            const match = store.lines[index], p = match.price, item = p && plan.items.find(i => i.id === p.itemId);
            return <div className="grocery-purchase-match" key={store.name}><div><strong>{store.name}</strong><small>{match.scenario ? `Rate per ${match.scenario.referenceSize} ${match.scenario.referenceUnit} · observed on ${p?.evidence.date}` : match.comparisonEvidence ? `${match.comparisonEvidence.referenceFormatLabel} · comparable, observed on ${p?.evidence.date}` : p ? `${p.size} ${p.unit === "each" ? item?.countUnit || "units" : p.unit}` : "Reference missing"}</small>{match.confidence === "estimated" && <small>{match.scenario?.relation === "estimated-substitution" ? "Estimated substitution" : "Estimate"}{(match.scenario?.ageDays ?? 0) > 7 ? ` · price is ${match.scenario!.ageDays} days old` : ""}</small>}</div><div className="grocery-purchase-price">{!match.reason && <span className="grocery-calculated">{match.confidence === "estimated" ? "Estimated" : "Verified"}</span>}{!match.reason && match.calculated && <span className="grocery-calculated">Calculated</span>}<strong>{match.reason ? "Unavailable" : money(match.normalized, record.receipt.currency)}</strong></div></div>;
          })}
          <details><summary>Pack sizes, calculations and sources</summary><p>Purchase source: {line.evidence || "No evidence"}</p>{sourceQuote && <p>{sourceQuote.quantity} × {money(sourceQuote.unitPrice, sourceQuote.currency)} = {money(sourceQuote.amount, sourceQuote.currency)} estimated. {sourceQuote.sourceEvidence} Reviewed on {sourceQuote.reviewedAt}. No current catalogue price or final payment is inferred.</p>}{derived && <><p>{derived.provenance}</p><p>{derived.sourceEstimateEvidence}</p><p>Comparable pack size for comparison only. SKU and brand may differ. No basket substitution is authorised. Reviewed on {derived.reviewedAt}.</p></>}{comparisons.map(store => {
            const match = store.lines[index], p = match.price, link = p && grocerySourceLink(p.evidence.url);
            if (match.scenario && p) return <GroceryPurchaseScenario key={store.name} scenario={match.scenario} price={p} store={store.name} onSourceReceipt={id => { const source = records.find(r => r.id === id); if (source) { requestClose(() => onReview(source)); } }} />;
            return <section className="grocery-purchase-evidence" key={store.name}><strong>{store.name}</strong>{match.reason && <p>{match.reason} · amount excluded from comparison.</p>}{p && <><p>{p.product} · {p.size} {p.unit} · {money(p.price, p.currency)} per pack, observed on {p.evidence.date || "unknown date"}.</p>{!match.reason && <><p>{money(p.price, p.currency)} × {Number((match.ratio! * p.size).toFixed(6))}/{p.size} = {money(match.normalized, p.currency)} for the source quantity.</p><p>{p.weighed ? "Sold by weight" : `${match.packs} whole pack(s)`} : {money(match.outlay, p.currency)} before taxes and fees.</p></>}<p>{p.matchNote} · {p.locality} · {modeLabels[p.mode || "unknown"]}. {p.evidence.until ? `Valid until ${p.evidence.until}.` : "Confirm price validity."} Check availability before buying.</p>{link && <a href={link.href} target="_blank" rel="noreferrer">{link.label}</a>}</>}</section>;
          })}<GroceryReferenceLeads state={resolution} product={line.product || line.name} /></details>
        </article>; })}
        <details className="grocery-purchase-provenance"><summary>Purchase evidence and limitations</summary><p>{purchaseStatus(record)}</p><p>The source total includes its own fees, taxes and discounts. It is not compared with competitors’ item-only totals to claim a saving.</p>{record.receipt.fulfillment && <p>Delivered on {dateLabel(record.receipt.fulfillment.date)} : {record.receipt.fulfillment.evidence}</p>}<p>Original source: {record.receipt.date || "unknown date"} · reference {record.receipt.reference || "unknown"}.</p>{record.receipt.warnings.map((w, i) => <p key={i}>{w}</p>)}<div className="grocery-purchase-totals">{totals(record)}</div>{comparisons.map(store => <p key={store.name}>{store.name} : {store.covered}/{store.count} compared, including {store.estimated} estimated. {store.outlay === null ? "Whole-pack cost not calculated." : `${store.estimated ? "Whole-pack scenario" : "Available pack sizes"} : ${money(store.outlay, record.receipt.currency)}, before taxes and fees.`}</p>)}<button className="text-action" onClick={() => { requestClose(() => onReview(record)); }}>View sources and review receipt</button></details>
      </div>}
    </Sheet>
  </section>;
}
