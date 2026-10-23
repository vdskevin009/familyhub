import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WorkerConfig, SavingsState } from "./types";
import { fetchInvoices, fetchFinances, fetchSharedSavings, fetchSharedResearch } from "./worker";
import { fetchMortgage } from "./mortgage-api";
import { groceryRequest, loadGroceries } from "./grocery-api";
import type { GroceryPlan } from "../../worker/src/grocery-planning";
import type { OpportunityActionsSnapshot } from "../../worker/src/opportunity-actions";
import { applyOpportunityDecisions, buildOpportunityFeed, dateOnly, sourceLabels, type Opportunity, type OpportunityInputs, type SourceHealth, type SourceId } from "./opportunities";

const sourceIds = Object.keys(sourceLabels) as SourceId[];
export function emptyOpportunityInputs(status: SourceHealth["status"] = "loading"): OpportunityInputs {
  return Object.fromEntries(sourceIds.map(id => [id, { id, label: sourceLabels[id], status, data: null, checkedAt: null, sourceDate: null, error: null }])) as OpportunityInputs;
}
const latestDate = (values: (string | null | undefined)[]) => values.map(dateOnly).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
function observationDate(id: SourceId, value: unknown): string | null {
  switch (id) {
    case "claims": return dateOnly((value as OpportunityInputs["claims"]["data"])?.lastSuccess);
    case "contracts": return latestDate((value as NonNullable<OpportunityInputs["contracts"]["data"]>).records.map(r => r.contract.billing?.asOf));
    case "research": return latestDate((value as NonNullable<OpportunityInputs["research"]["data"]>).jobs.flatMap(j => j.report?.offers.map(o => o.checkedAt) ?? []));
    case "finances": return dateOnly((value as OpportunityInputs["finances"]["data"])?.data?.collectedOn);
    case "groceries": return latestDate((value as GroceryPlan).prices.map(p => p.evidence.date));
    case "purchases": return latestDate((value as NonNullable<OpportunityInputs["purchases"]["data"]>).records.map(r => r.receipt.date));
    case "mortgage": return latestDate((value as NonNullable<OpportunityInputs["mortgage"]["data"]>).snapshots.map(s => s.collectedAt));
  }
}
export type OpportunityLoaders = Record<SourceId, () => Promise<unknown>>;
/** Each read settles independently. Retrieval time never substitutes for evidence time. */
export async function collectOpportunitySources(loaders: OpportunityLoaders, publish: (source: SourceHealth & { data: unknown }) => void, now = () => new Date().toISOString()) {
  return Promise.allSettled(sourceIds.map(async id => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const data = await Promise.race([loaders[id](), new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("timeout")), 35_000); })]);
      if (!data || typeof data !== "object") throw new Error("invalid-source");
      const sourceDate = observationDate(id, data);
      publish({ id, label: sourceLabels[id], status: "ready", data, checkedAt: now(), sourceDate, error: null });
    } catch {
      // Remote errors may include private URLs or internal details. Keep the card message generic.
      publish({ id, label: sourceLabels[id], status: "error", data: null, checkedAt: now(), sourceDate: null, error: "Source indisponible. Vérifiez le PC puis actualisez." });
    } finally { if (timeout !== undefined) clearTimeout(timeout); }
  }));
}
export type OpportunityAction = "seen" | "snooze" | "dismiss" | "resolve" | "restore";
async function actionRequest(config: WorkerConfig, body?: object): Promise<OpportunityActionsSnapshot> {
  const response = await fetch(config.Endpoint.trim().replace(/\/$/, "") + "/opportunity-actions", {
    method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", "x-familyhub-key": config.ApiKey.trim() },
    ...(body ? { body: JSON.stringify(body) } : {}), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) throw new Error(response.status === 409 ? "La liste a changé sur un autre appareil. Actualisez avant de réessayer." : response.status === 404 ? "Le suivi des actions nécessite la mise à jour du PC." : "Le suivi n’a pas été enregistré. Actualisez avant de réessayer.");
  const result = await response.json() as OpportunityActionsSnapshot;
  if (result.schema !== 1 || typeof result.revision !== "string" || !result.decisions || typeof result.decisions !== "object" || Array.isArray(result.decisions)) throw new Error("Le suivi reçu n’est pas lisible. Aucune action enregistrée.");
  return result;
}

const noReviews: NonNullable<SavingsState["Reviews"]> = [];
export function useOpportunities(config: WorkerConfig, reviews: SavingsState["Reviews"] = noReviews) {
  const configured = Boolean(config.Endpoint.trim() && config.ApiKey.trim());
  const [inputs, setInputs] = useState<OpportunityInputs>(() => emptyOpportunityInputs(configured ? "loading" : "unpaired"));
  const [feed, setFeed] = useState<Awaited<ReturnType<typeof buildOpportunityFeed>>>({ opportunities: [], recoverable: { amount: null, currency: "CAD", known: 0, unknown: 0 } });
  const [actions, setActions] = useState<OpportunityActionsSnapshot | null>(null), [actionError, setActionError] = useState(""), [actionBusy, setActionBusy] = useState(false);
  const [refreshId, setRefreshId] = useState(0), [clock, setClock] = useState(() => new Date().toISOString());
  const active = useRef(0), actionLock = useRef(false), currentActions = useRef(actions);
  currentActions.current = actions;
  const refresh = useCallback(() => setRefreshId(id => id + 1), []);
  useEffect(() => {
    const generation = ++active.current;
    setInputs(emptyOpportunityInputs(configured ? "loading" : "unpaired"));
    setFeed({ opportunities: [], recoverable: { amount: null, currency: "CAD", known: 0, unknown: 0 } });
    setActions(null); setActionError(""); setClock(new Date().toISOString());
    if (!configured) return;
    const loaders: OpportunityLoaders = {
      claims: () => fetchInvoices(config), contracts: () => fetchSharedSavings(config), research: () => fetchSharedResearch(config), finances: () => fetchFinances(config),
      groceries: () => groceryRequest<GroceryPlan>(config, "/groceries/planning"), purchases: () => loadGroceries(config), mortgage: () => fetchMortgage(config, AbortSignal.timeout(30_000))
    };
    void collectOpportunitySources(loaders, source => {
      if (active.current === generation) setInputs(previous => ({ ...previous, [source.id]: source }) as OpportunityInputs);
    });
    void actionRequest(config).then(snapshot => { if (active.current === generation) setActions(snapshot); }).catch(error => {
      if (active.current === generation) setActionError(error instanceof Error ? error.message : "Le suivi des actions est indisponible.");
    });
    return () => { if (active.current === generation) active.current++; };
  }, [config.Endpoint, config.ApiKey, configured, refreshId]);
  useEffect(() => {
    let cancelled = false;
    void buildOpportunityFeed(inputs, clock, reviews).then(result => { if (!cancelled) setFeed(result); }).catch(() => {
      if (!cancelled) {
        // A malformed projection must not create an all-clear or retain unqualified totals.
        setFeed({ opportunities: [], recoverable: { amount: null, currency: "CAD", known: 0, unknown: 0 } });
        setActionError("Certaines preuves ne peuvent pas être interprétées. Actualisez les sources avant de décider.");
      }
    });
    return () => { cancelled = true; };
  }, [inputs, clock, reviews]);
  useEffect(() => {
    const interval = setInterval(() => setClock(new Date().toISOString()), 60_000);
    return () => clearInterval(interval);
  }, []);
  const setAction = useCallback(async (opportunity: Opportunity, action: OpportunityAction, options: { snoozedUntil?: string; reason?: string } = {}) => {
    if (actionLock.current) return false;
    const snapshot = currentActions.current;
    if (!snapshot || !configured) { setActionError("Reconnectez le PC pour enregistrer cette action."); return false; }
    actionLock.current = true; setActionBusy(true); setActionError("");
    const generation = active.current;
    try {
      const result = await actionRequest(config, { expectedRevision: snapshot.revision, opportunityId: opportunity.id, evidenceVersion: opportunity.evidenceVersion, action, ...options });
      if (generation === active.current) { currentActions.current = result; setActions(result); return true; }
      return false;
    } catch (error) {
      if (generation === active.current) setActionError(error instanceof Error ? error.message : "Action non confirmée. Actualisez avant de réessayer.");
      return false;
    } finally { actionLock.current = false; if (generation === active.current) setActionBusy(false); }
  }, [config.Endpoint, config.ApiKey, configured]);
  const sources: SourceHealth[] = sourceIds.map(id => { const { data: _data, ...source } = inputs[id]; return source; });
  const visible = useMemo(() => applyOpportunityDecisions(feed.opportunities, actions?.decisions ?? {}, clock), [feed.opportunities, actions, clock]);
  return { ...visible, sources, loading: sources.some(s => s.status === "loading"), refresh, configured, connected: sources.some(s => s.status === "ready"), recoverable: feed.recoverable,
    observedAt: null, actions, setAction, actionBusy, actionError, actionsAvailable: actions !== null };
}
