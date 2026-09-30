import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleDollarSign, ExternalLink, RefreshCw } from "lucide-react";
import { dateLabel } from "../domain";
import { googleBridge } from "../google";
import { buildInvoiceHistoryCases, excludeAssignedUnmatched, filterInvoiceHistoryCases, filterReimbursementWorkflowCases, healthcareTitle, insurerEvidenceExpenseCases, mergeInvoiceItems, mergeReconciliationHistory, namedInsurerReimbursementAmount, primaryReimbursementAmount, reimbursementActionLabel, reimbursementCaseStatus, reimbursementEvidenceSources, reimbursementInvoicePdfOptions, reimbursementWorkflowStatus, reimbursementWorkflowSummary, secondaryReimbursementAmount } from "../invoice-state";
import type { InvoiceHistoryFilter, ReimbursementCaseStatus, ReimbursementInvoicePdfOption, ReimbursementPersonScope, WorkflowStatusFilter } from "../invoice-state";
import type { HubState } from "../state";
import type { MatchAssignment, ReconciliationCase, ReimbursementItem, ReimbursementWorkflowStatus, UnmatchedReimbursement } from "../types";
import { fetchInvoices, fetchBlueCrossStatus, syncBlueCross, fetchDesjardinsStatus, syncDesjardins, manualReconciliationWorkerVersion, setManualMatch, setMatchDecision, setReimbursementWorkflowStatus, setUnmatchedIgnored, testWorker, viewWorkerAttachment, workerVersionAtLeast } from "../worker";
import type { BlueCrossSyncStatus, BlueCrossSyncResult, DesjardinsSyncStatus, DesjardinsSyncResult } from "../worker";
import ReconciliationQueue from "./ReconciliationQueue";

type Props = { hub: HubState };
const statusCopy: Record<ReimbursementCaseStatus, string> = {
  "fully-reimbursed": "Fully reimbursed",
  "waiting-primary": "Waiting for primary",
  "waiting-secondary": "Waiting for secondary",
  "patient-balance": "Patient balance",
  "needs-attention": "Needs attention"
};

function money(value: number | null | undefined, code = "CAD"): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  try { return new Intl.NumberFormat("en-CA", { style: "currency", currency: code || "CAD" }).format(value); }
  catch { return `${value.toFixed(2)} ${code || "CAD"}`; }
}

function dateValue(value: string | null | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

function unmatchedReason(item: UnmatchedReimbursement): string {
  if (item.Reason === "ambiguous-match") return "More than one expense could match this reimbursement. FamilyHub left it unmatched.";
  if (item.Reason === "missing-insurer") return "The insurer could not be identified confidently.";
  if (item.Reason === "needs-review") return "The imported document needs classification review before matching.";
  return "No healthcare expense could be matched confidently.";
}

function reimbursementAmount(item: ReimbursementItem): number | null {
  return item.ReimbursedAmount ?? item.DetectedAmount ?? null;
}

export default function ReimbursementsView({ hub }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lastSuccess, setLastSuccess] = useState("");
  const [savingId, setSavingId] = useState("");
  const [savedMessage, setSavedMessage] = useState("");
  const [expandedMatchId, setExpandedMatchId] = useState("");
  const [selectedClaimIds, setSelectedClaimIds] = useState<Set<string>>(() => new Set());
  const [bulkIgnoring, setBulkIgnoring] = useState(false);
  const [filters, setFilters] = useState<Set<InvoiceHistoryFilter>>(() => new Set());
  const [personScope, setPersonScope] = useState<ReimbursementPersonScope>("all");
  const [workflowFilter, setWorkflowFilter] = useState<WorkflowStatusFilter>("open");
  const [sourceFilter, setSourceFilter] = useState<"all" | "email" | "blue-cross" | "desjardins">("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [workerVersion, setWorkerVersion] = useState("");
  const [screen, setScreen] = useState<"claims" | "reconcile">("claims");
  const [blueCrossStatus, setBlueCrossStatus] = useState<BlueCrossSyncStatus | null>(null);
  const [blueCrossResult, setBlueCrossResult] = useState<BlueCrossSyncResult | null>(null);
  const [blueCrossBusy, setBlueCrossBusy] = useState(false);
  const [desjardinsStatus, setDesjardinsStatus] = useState<DesjardinsSyncStatus | null>(null);
  const [desjardinsResult, setDesjardinsResult] = useState<DesjardinsSyncResult | null>(null);
  const [desjardinsBusy, setDesjardinsBusy] = useState(false);
  const paired = Boolean(hub.worker.Endpoint.trim() && hub.worker.ApiKey.trim());
  const manualActionsAvailable = !workerVersion || workerVersionAtLeast(workerVersion, manualReconciliationWorkerVersion);

  async function refresh() {
    if (!paired) return;
    setBusy(true); setError("");
    try {
      const snapshot = await fetchInvoices(hub.worker);
      hub.setReimbursements(previous => ({
        ...previous,
        SchemaVersion: 2,
        Items: mergeInvoiceItems(previous.Items, snapshot.items),
        Reconciliations: mergeReconciliationHistory(previous.Reconciliations ?? [], snapshot.reconciliations, mergeInvoiceItems(previous.Items, snapshot.items)),
        CleanupSuggestions: snapshot.cleanupSuggestions,
        ImportantMail: snapshot.importantMail,
        LearningDecisions: snapshot.learning.decisions,
        UnmatchedReimbursements: snapshot.unmatchedReimbursements,
        IgnoredUnmatchedReimbursements: snapshot.ignoredUnmatchedReimbursements,
        AgentReviews: snapshot.agentReviews ?? [],
        IgnoredExpenses: snapshot.ignoredExpenses ?? [],
        InvoiceCoverage: snapshot.coverage
      }));
      setLastSuccess(snapshot.lastSuccess || new Date().toISOString());
      if (snapshot.error) setError(snapshot.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The PC results could not be refreshed.");
    } finally { setBusy(false); }
  }

  useEffect(() => {
    if (!paired) { setWorkerVersion(""); return; }
    void refresh();
    void testWorker(hub.worker).then(health => setWorkerVersion(health.version || "")).catch(() => setWorkerVersion(""));
    void fetchBlueCrossStatus(hub.worker).then(setBlueCrossStatus).catch(() => setBlueCrossStatus(null));
    void fetchDesjardinsStatus(hub.worker).then(setDesjardinsStatus).catch(() => setDesjardinsStatus(null));
  }, [paired, hub.worker.Endpoint, hub.worker.ApiKey]);

  async function runBlueCrossSync(apply: boolean) {
    if (!paired || blueCrossBusy) return;
    setBlueCrossBusy(true); setError(""); setBlueCrossResult(null);
    try {
      const result = await syncBlueCross(hub.worker, apply);
      setBlueCrossResult(result);
      setBlueCrossStatus(await fetchBlueCrossStatus(hub.worker));
      if (result.status === "success" && apply) await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Blue Cross sync failed."); }
    finally { setBlueCrossBusy(false); }
  }

  async function runDesjardinsSync(apply: boolean) {
    if (!paired || desjardinsBusy) return;
    setDesjardinsBusy(true); setError(""); setDesjardinsResult(null);
    try {
      const result = await syncDesjardins(hub.worker, apply);
      setDesjardinsResult(result);
      setDesjardinsStatus(await fetchDesjardinsStatus(hub.worker));
      if (result.status === "success" && apply) await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Desjardins sync failed."); }
    finally { setDesjardinsBusy(false); }
  }

  async function decideMatch(assignment: MatchAssignment, decision: "confirmed" | "rejected") {
    if (!paired || savingId) return;
    const key = `match:${assignment.ReimbursementDocumentId}`;
    setSavingId(key); setError(""); setSavedMessage("");
    try {
      await setMatchDecision(hub.worker, assignment.ReimbursementDocumentId, assignment.ExpenseDocumentId, decision);
      await refresh();
      setSavedMessage(decision === "confirmed"
        ? "Match confirmed manually. FamilyHub will keep this association across future refreshes."
        : "Match rejected. FamilyHub will not recreate this same pairing automatically.");
    } catch (err) { setError(err instanceof Error ? err.message : "The match decision could not be saved. Refresh and try again."); }
    finally { setSavingId(""); }
  }

  async function matchUnmatched(item: ReconciliationCase, reimbursementId: string) {
    if (!paired || savingId) return;
    const expenseId = item.ExpenseDocumentId || item.ExpenseDocumentIds?.[0] || item.DocumentIds[0];
    if (!expenseId) return;
    const key = `manual-match:${reimbursementId}`;
    setSavingId(key); setError(""); setSavedMessage("");
    try {
      await setManualMatch(hub.worker, reimbursementId, expenseId);
      await refresh();
      setSavedMessage("Reimbursement matched manually. FamilyHub will keep this assignment across refreshes and rescans.");
    } catch (err) { setError(err instanceof Error ? err.message : "The manual match could not be saved. Refresh and try again."); }
    finally { setSavingId(""); }
  }

  async function changeUnmatchedIgnored(reimbursementId: string, ignored: boolean) {
    if (!paired || savingId) return;
    const key = `unmatched-ignore:${reimbursementId}`;
    setSavingId(key); setError(""); setSavedMessage("");
    try {
      await setUnmatchedIgnored(hub.worker, reimbursementId, ignored);
      await refresh();
      setSavedMessage(ignored
        ? "Unmatched reimbursement ignored. It will stay out of the active review queue until restored."
        : "Ignored reimbursement restored to matching and review.");
    } catch (err) { setError(err instanceof Error ? err.message : "The unmatched reimbursement decision could not be saved."); }
    finally { setSavingId(""); }
  }

  async function openInvoicePdf(option: ReimbursementInvoicePdfOption) {
    if (option.Source !== "worker" || savingId) return;
    const source = invoiceById.get(option.ItemId);
    if (!source) { setError("Invoice source is no longer available. Refresh and try again."); return; }
    const key = `pdf:${option.ItemId}:${option.AttachmentIndex}`;
    setSavingId(key); setError(""); setSavedMessage("");
    try {
      await viewWorkerAttachment(hub.worker, source, option.AttachmentIndex);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The invoice PDF could not be opened. Try again while the PC worker is online.");
    } finally { setSavingId(""); }
  }

  function workflowExpenseId(item: ReconciliationCase): string | null {
    return item.ExpenseDocumentId || item.ExpenseDocumentIds?.[0] || item.DocumentIds[0] || null;
  }

  async function ignoreSelectedClaims(items: ReconciliationCase[]) {
    if (!paired || bulkIgnoring || savingId) return;
    const targets = items
      .map(item => ({ item, expenseId: item.InferredFromInsurer ? null : workflowExpenseId(item) }))
      .filter((entry): entry is { item: ReconciliationCase; expenseId: string } => Boolean(entry.expenseId)
        && reimbursementWorkflowStatus(entry.item) !== "ignore"
        && selectedClaimIds.has(entry.item.Id));
    if (!targets.length) return;
    setBulkIgnoring(true); setError(""); setSavedMessage("");
    try {
      for (const target of targets) await setReimbursementWorkflowStatus(hub.worker, target.expenseId, "ignore");
      setSelectedClaimIds(new Set());
      await refresh();
      setSavedMessage(`${targets.length} claim${targets.length === 1 ? "" : "s"} ignored. The source evidence is preserved and each claim can be restored from the Ignore filter.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The selected claims could not all be ignored. Refresh to see the saved state and try again.");
      await refresh();
    } finally { setBulkIgnoring(false); }
  }

  async function changeWorkflow(item: ReconciliationCase, status: ReimbursementWorkflowStatus | "automatic") {
    if (!paired || savingId) return;
    const expenseId = item.ExpenseDocumentId || item.ExpenseDocumentIds?.[0] || item.DocumentIds[0];
    if (!expenseId) return;
    const key = `workflow:${expenseId}`;
    setSavingId(key); setError(""); setSavedMessage("");
    try {
      await setReimbursementWorkflowStatus(hub.worker, expenseId, status);
      await refresh();
      setSavedMessage(status === "automatic"
        ? "Manual override removed. FamilyHub is using the automatic workflow rule again."
        : `Workflow marked ${status}. This manual choice will survive refreshes and rescans.`);
    } catch (err) { setError(err instanceof Error ? err.message : "The workflow status could not be saved. Refresh and try again."); }
    finally { setSavingId(""); }
  }

  const model = useMemo(() => {
    const byId = new Map(hub.reimbursements.Items.map(item => [item.Id, item]));
    const ignoredCases = (hub.reimbursements.IgnoredExpenses ?? []).map(item => ({
      ...item,
      WorkflowStatus: item.WorkflowStatus ?? "ignore" as const,
      WorkflowOrigin: item.WorkflowOrigin ?? "manual" as const
    }));
    const baseCases = [...(hub.reimbursements.Reconciliations ?? []), ...ignoredCases];
    const inferredCases = insurerEvidenceExpenseCases(baseCases, hub.reimbursements.UnmatchedReimbursements ?? [], hub.reimbursements.Items);
    const inferredSourceIds = new Set(inferredCases.flatMap(item => item.DocumentIds));
    const cases = buildInvoiceHistoryCases([...baseCases, ...inferredCases], hub.reimbursements.Items);
    const unmatched = excludeAssignedUnmatched(hub.reimbursements.UnmatchedReimbursements ?? [], cases)
      .filter(result => !inferredSourceIds.has(result.DocumentId))
      .map(result => ({ result, item: byId.get(result.DocumentId) }))
      .filter((entry): entry is { result: UnmatchedReimbursement; item: ReimbursementItem } => Boolean(entry.item))
      .sort((a, b) => dateValue(b.item.ServiceDate || b.item.StatementDate || b.item.ReceivedAt)
        - dateValue(a.item.ServiceDate || a.item.StatementDate || a.item.ReceivedAt));
    const ignoredUnmatched = (hub.reimbursements.IgnoredUnmatchedReimbursements ?? [])
      .map(result => ({ result, item: byId.get(result.DocumentId) }))
      .filter((entry): entry is { result: UnmatchedReimbursement; item: ReimbursementItem } => Boolean(entry.item))
      .sort((a, b) => dateValue(b.item.ServiceDate || b.item.StatementDate || b.item.ReceivedAt)
        - dateValue(a.item.ServiceDate || a.item.StatementDate || a.item.ReceivedAt));
    const warnings = [...new Set(hub.reimbursements.Items.filter(item => item.Status !== 4).map(item => item.ImportWarning).filter(Boolean))];
    return { cases, unmatched, ignoredUnmatched, warnings };
  }, [hub.reimbursements.Items, hub.reimbursements.Reconciliations, hub.reimbursements.IgnoredExpenses, hub.reimbursements.UnmatchedReimbursements, hub.reimbursements.IgnoredUnmatchedReimbursements]);

  const reviews = new Map((hub.reimbursements.AgentReviews ?? []).map(review => [review.key, review]));
  const invoiceById = useMemo(() => new Map(hub.reimbursements.Items.map(item => [item.Id, item])), [hub.reimbursements.Items]);
  const scopedCases = useMemo(() => filterReimbursementWorkflowCases(model.cases, personScope, "all"), [model.cases, personScope]);
  const scopedUnmatched = useMemo(() => model.unmatched.filter(({ item }) => personScope === "all" || item.Member === personScope), [model.unmatched, personScope]);
  const scopedIgnoredUnmatched = useMemo(() => model.ignoredUnmatched.filter(({ item }) => personScope === "all" || item.Member === personScope), [model.ignoredUnmatched, personScope]);

  const scopeSummaries = useMemo(() => {
    const scopes: ReimbursementPersonScope[] = ["all", "Kevin", "Jasmine", "Nathan"];
    return new Map(scopes.map(scope => [scope, reimbursementWorkflowSummary(model.cases, scope)]));
  }, [model.cases]);

  const workflowCounts = useMemo(() => ({
    open: scopedCases.filter(item => reimbursementWorkflowStatus(item) === "open").length,
    closed: scopedCases.filter(item => reimbursementWorkflowStatus(item) === "closed").length,
    ignore: scopedCases.filter(item => reimbursementWorkflowStatus(item) === "ignore").length
  }), [scopedCases]);

  const workflowScopedCases = useMemo(() => filterReimbursementWorkflowCases(model.cases, personScope, workflowFilter),
    [model.cases, personScope, workflowFilter]);

  const finance = useMemo(() => {
    const cad = workflowScopedCases.filter(item => !item.PreviouslyFound && reimbursementWorkflowStatus(item) !== "ignore" && (item.Currency || "CAD") === "CAD");
    return {
      totalPaid: cad.reduce((sum, item) => sum + (item.OriginalAmount ?? 0), 0),
      primary: cad.reduce((sum, item) => sum + (primaryReimbursementAmount(item) ?? 0), 0),
      secondary: cad.reduce((sum, item) => sum + (secondaryReimbursementAmount(item) ?? 0), 0),
      desjardins: cad.reduce((sum, item) => sum + (namedInsurerReimbursementAmount(item, "Desjardins", invoiceById) ?? 0), 0),
      blueCross: cad.reduce((sum, item) => sum + (namedInsurerReimbursementAmount(item, "Blue Cross", invoiceById) ?? 0), 0),
      outstanding: cad.reduce((sum, item) => sum + (item.PotentialRemaining ?? 0), 0),
      attention: workflowScopedCases.filter(item => reimbursementWorkflowStatus(item) === "open" && reimbursementCaseStatus(item) === "needs-attention").length
        + (workflowFilter === "open" || workflowFilter === "all" ? scopedUnmatched.length : 0)
    };
  }, [workflowScopedCases, workflowFilter, scopedUnmatched, invoiceById]);

  const filterCounts = useMemo(() => ({
    fully: scopedCases.filter(item => reimbursementCaseStatus(item) === "fully-reimbursed").length,
    outstanding: scopedCases.filter(item => reimbursementCaseStatus(item) !== "fully-reimbursed").length,
    primary: scopedCases.filter(item => (primaryReimbursementAmount(item) ?? 0) > 0).length,
    secondary: scopedCases.filter(item => (secondaryReimbursementAmount(item) ?? 0) > 0).length,
    email: scopedCases.filter(item => reimbursementEvidenceSources(item, invoiceById).includes("Email")).length,
    blueCross: scopedCases.filter(item => reimbursementEvidenceSources(item, invoiceById).includes("Blue Cross")).length,
    desjardins: scopedCases.filter(item => reimbursementEvidenceSources(item, invoiceById).includes("Desjardins")).length
  }), [invoiceById, scopedCases]);

  const activeFilterCount = filters.size
    + (workflowFilter === "open" ? 0 : 1)
    + (sourceFilter === "all" ? 0 : 1);
  const workflowLabel = workflowFilter === "all"
    ? "All"
    : workflowFilter[0].toUpperCase() + workflowFilter.slice(1);
  const workflowVisibleCount = workflowFilter === "open"
    ? workflowCounts.open
    : workflowFilter === "closed"
      ? workflowCounts.closed
      : workflowFilter === "ignore"
        ? workflowCounts.ignore
        : scopedCases.length;

  const filteredCases = useMemo(() => {
    const history = filterInvoiceHistoryCases(workflowScopedCases, filters);
    if (sourceFilter === "all") return history;
    const source = sourceFilter === "email" ? "Email" : sourceFilter === "blue-cross" ? "Blue Cross" : "Desjardins";
    return history.filter(item => reimbursementEvidenceSources(item, invoiceById).includes(source));
  }, [filters, invoiceById, sourceFilter, workflowScopedCases]);

  const selectableVisibleCases = useMemo(() => filteredCases.filter(item =>
    !item.InferredFromInsurer && reimbursementWorkflowStatus(item) !== "ignore" && Boolean(workflowExpenseId(item))),
    [filteredCases]);
  const selectedVisibleCount = selectableVisibleCases.filter(item => selectedClaimIds.has(item.Id)).length;
  const allVisibleSelected = selectableVisibleCases.length > 0 && selectedVisibleCount === selectableVisibleCases.length;

  useEffect(() => {
    const visible = new Set(selectableVisibleCases.map(item => item.Id));
    setSelectedClaimIds(previous => new Set([...previous].filter(id => visible.has(id))));
  }, [selectableVisibleCases.map(item => item.Id).join("|")]);

  const scopeLabel = personScope === "all" ? "All family" : personScope;

  function selectScope(scope: ReimbursementPersonScope) {
    setPersonScope(scope);
    setWorkflowFilter("open");
    setSourceFilter("all");
    setFilters(new Set<InvoiceHistoryFilter>());
    setFiltersOpen(false);
  }

  function toggleFilter(filter: InvoiceHistoryFilter) {
    setFilters(previous => {
      const next = new Set(previous);
      if (next.has(filter)) next.delete(filter);
      else next.add(filter);
      return next;
    });
  }

  return <div className="view-stack reimbursement-app-view">
    <section className="reimbursement-toolbar">
      <div className="reimbursement-toolbar-main">
        <h1 className="reimbursement-tool-title">Reimbursements</h1>
        <span>{lastSuccess ? `Updated ${new Date(lastSuccess).toLocaleString()}` : "Saved results available"}</span>
      </div>
      <div className="reimbursement-toolbar-actions">
        <details className="reimbursement-data-status">
          <summary>Data</summary>
          <p>{hub.reimbursements.InvoiceCoverage?.complete
            ? "Potential invoice search completed since June 1, 2025 for connected accounts. Scanned images and unreadable attachments may still need review."
            : "Historical collection since June 1, 2025 is not yet confirmed complete. Run the PC collection to resume it."} Insurance coverage is not confirmed by a receipt.</p>
        </details>
        <button className="button secondary compact-button" aria-label="Refresh reimbursements" disabled={!paired || busy} onClick={() => void refresh()}>
          <RefreshCw size={16} className={busy ? "spin" : ""} />{busy ? "Refreshing…" : "Refresh"}
        </button>
      </div>
    </section>

    <section className="bluecross-sync" aria-label="Blue Cross portal sync">
      <button type="button" className="button secondary compact-button" disabled={!paired || blueCrossBusy || !!workerVersion && !workerVersionAtLeast(workerVersion, "2.9.0")}
        onClick={() => void runBlueCrossSync(false)}>{blueCrossBusy ? "Synchronisation Blue Cross…" : "Mettre à jour Blue Cross"}</button>
      {blueCrossResult?.status === "success" && blueCrossResult.complete && !blueCrossResult.applied && !blueCrossResult.ambiguous &&
        <button type="button" className="button secondary compact-button" disabled={blueCrossBusy} onClick={() => void runBlueCrossSync(true)}>Appliquer Blue Cross</button>}
      <small role="status">{blueCrossResult?.status === "login-required" || blueCrossStatus?.state === "login-required" ? "Connexion Blue Cross requise sur le PC (commande --login)."
        : blueCrossResult?.status === "success" ? `${blueCrossResult.new ?? 0} nouveaux · ${blueCrossResult.changed ?? 0} mis à jour · ${blueCrossResult.unchanged ?? 0} inchangés${blueCrossResult.complete ? "" : " · collecte incomplète"}${blueCrossResult.applied ? ` · ${blueCrossResult.unmatched ?? 0} à réconcilier` : " · aperçu seulement"}`
        : blueCrossStatus?.state === "error" ? `Erreur Blue Cross : ${blueCrossStatus.error || "échec de la synchronisation"}`
        : blueCrossStatus?.lastSuccess ? `${blueCrossStatus.state === "up-to-date" ? "À jour" : "Aperçu disponible"} · ${blueCrossStatus.found ?? 0} lignes · dernière collecte ${new Date(blueCrossStatus.lastSuccess).toLocaleString()}`
        : "Synchronisation manuelle · aucun historique Blue Cross synchronisé"}</small>
      {blueCrossStatus?.lastAttempt && <small>Dernière tentative : {new Date(blueCrossStatus.lastAttempt).toLocaleString()}</small>}
    </section>

    <section className="bluecross-sync" aria-label="Desjardins portal sync">
      <button type="button" className="button secondary compact-button" disabled={!paired || desjardinsBusy || !!workerVersion && !workerVersionAtLeast(workerVersion, "2.10.0")}
        onClick={() => void runDesjardinsSync(false)}>{desjardinsBusy ? "Synchronisation Desjardins…" : "Mettre à jour Desjardins"}</button>
      {desjardinsStatus?.applicable && desjardinsStatus.previewAt && Date.now() - Date.parse(desjardinsStatus.previewAt) < 24 * 60 * 60_000 &&
        <button type="button" className="button secondary compact-button" disabled={desjardinsBusy} onClick={() => void runDesjardinsSync(true)}>Appliquer Desjardins</button>}
      <small role="status">{desjardinsResult?.status === "login-required" || desjardinsStatus?.state === "login-required" ? "Connexion Desjardins requise sur le PC (commande --login)."
        : desjardinsResult?.status === "success" ? `${desjardinsResult.new ?? 0} nouveaux · ${desjardinsResult.changed ?? 0} mis à jour · ${desjardinsResult.unchanged ?? 0} inchangés${desjardinsResult.ambiguous ? ` · ${desjardinsResult.ambiguous} à vérifier` : ""}${desjardinsResult.complete ? "" : " · collecte incomplète"}${desjardinsResult.applied ? ` · ${desjardinsResult.unmatched ?? 0} à réconcilier` : " · aperçu seulement"}`
        : desjardinsStatus?.state === "error" ? `Erreur Desjardins : ${desjardinsStatus.error || "échec de la synchronisation"}`
        : desjardinsStatus?.lastSuccess ? `${desjardinsStatus.state === "up-to-date" ? "À jour" : "Aperçu disponible"} · ${desjardinsStatus.found ?? 0} lignes · dernière collecte ${new Date(desjardinsStatus.lastSuccess).toLocaleString()}`
        : "Synchronisation manuelle · aucun historique Desjardins synchronisé"}</small>
      {desjardinsStatus?.lastAttempt && <small>Dernière tentative : {new Date(desjardinsStatus.lastAttempt).toLocaleString()}</small>}
    </section>

    {error && <div className="banner error" role="status"><AlertTriangle size={17} />{error} — Previously synced results remain below.</div>}
    {workerVersion && !manualActionsAvailable && <div className="banner error" role="status"><AlertTriangle size={17} />PC worker {workerVersion} is outdated for manual reimbursement matching. Update/restart the FamilyHub worker to {manualReconciliationWorkerVersion} or later, then refresh this page.</div>}
    {savedMessage && <div className="banner" role="status">{savedMessage}</div>}
    {model.warnings.map(warning => <div className="banner" role="status" key={warning}><AlertTriangle size={17} />{warning}</div>)}

    <section className="reimbursement-mode-tabs" aria-label="Claims workspace">
      <button type="button" className={screen === "claims" ? "active" : ""} aria-pressed={screen === "claims"} onClick={() => setScreen("claims")}>
        Claims
      </button>
      <button type="button" className={screen === "reconcile" ? "active" : ""} aria-pressed={screen === "reconcile"} onClick={() => setScreen("reconcile")}>
        À réconcilier <span>{model.unmatched.length}</span>
      </button>
    </section>

    {screen === "claims" ? <>
    <section className="reimbursement-family-scopes" aria-label="Reimbursements by family member">
      {(["all", "Kevin", "Jasmine", "Nathan"] as ReimbursementPersonScope[]).map(scope => {
        const summary = scopeSummaries.get(scope)!;
        const label = scope === "all" ? "All family" : scope;
        return <button type="button" key={scope} className={`family-scope-card ${personScope === scope ? "active" : ""}`}
          aria-pressed={personScope === scope} onClick={() => selectScope(scope)}>
          <small>{label}</small>
          <strong>{money(summary.potentiallyRecoverable)}</strong>
          <span>Potentially recoverable</span>
          <em>{summary.open} open {summary.open === 1 ? "case" : "cases"}</em>
        </button>;
      })}
    </section>

    <details className="reimbursement-totals">
      <summary>
        <span>Totals · {scopeLabel}</span>
        <strong>{money(finance.outstanding)} remaining{finance.attention ? ` · ${finance.attention} attention` : ""}</strong>
      </summary>
      <section className="reimbursement-summary" aria-label={`${scopeLabel} reimbursement summary`}>
        <article className="summary-primary"><small>Total expenses</small><strong>{money(finance.totalPaid)}</strong><span>{scopeLabel}</span></article>
        <article><small>{personScope === "Nathan" ? "Desjardins" : "Primary insurance"}</small><strong>{money(personScope === "Nathan" ? finance.desjardins : finance.primary)}</strong><span>reimbursed</span></article>
        <article><small>{personScope === "Nathan" ? "Blue Cross" : "Secondary insurance"}</small><strong>{money(personScope === "Nathan" ? finance.blueCross : finance.secondary)}</strong><span>reimbursed</span></article>
        <article><small>Remaining balance</small><strong>{money(finance.outstanding)}</strong><span>{workflowLabel.toLowerCase()} workflow</span></article>
        <article className={finance.attention ? "summary-attention" : ""}><small>Needs attention</small><strong>{finance.attention}</strong><span>items</span></article>
      </section>
    </details>

    <section className={`reimbursement-filter-bar ${filtersOpen ? "open" : ""}`} aria-label="Filter reimbursement history">
      <div className="reimbursement-filter-heading">
        <div className="reimbursement-filter-summary">
          <span className={`workflow-status ${workflowFilter === "all" ? "all" : workflowFilter}`}>{workflowLabel}</span>
          <div>
            <strong>{workflowVisibleCount} {workflowVisibleCount === 1 ? "case" : "cases"}</strong>
            <span>Newest first{activeFilterCount ? ` · ${activeFilterCount} extra filter${activeFilterCount === 1 ? "" : "s"}` : ""}</span>
          </div>
        </div>
        <div className="reimbursement-filter-actions">
          {activeFilterCount > 0 && <button type="button" className="filter-clear" onClick={() => {
            setFilters(new Set<InvoiceHistoryFilter>()); setWorkflowFilter("open"); setSourceFilter("all");
          }}>Reset</button>}
          <button type="button" className="filter-toggle" aria-expanded={filtersOpen} aria-controls="reimbursement-filter-panel"
            onClick={() => setFiltersOpen(open => !open)}>
            Filters
            {activeFilterCount > 0 && <span className="filter-toggle-count">{activeFilterCount}</span>}
            <span className="filter-toggle-chevron" aria-hidden="true">{filtersOpen ? "▴" : "▾"}</span>
          </button>
        </div>
      </div>

      {filtersOpen && <div className="reimbursement-filter-panel" id="reimbursement-filter-panel">
        <div className="reimbursement-filter-group">
          <small>Workflow</small>
          <div className="reimbursement-filter-chips">
            <button type="button" className={`filter-chip ${workflowFilter === "open" ? "active" : ""}`} onClick={() => setWorkflowFilter("open")}>Open <span>{workflowCounts.open}</span></button>
            <button type="button" className={`filter-chip ${workflowFilter === "closed" ? "active" : ""}`} onClick={() => setWorkflowFilter("closed")}>Closed <span>{workflowCounts.closed}</span></button>
            <button type="button" className={`filter-chip ${workflowFilter === "ignore" ? "active" : ""}`} onClick={() => setWorkflowFilter("ignore")}>Ignore <span>{workflowCounts.ignore}</span></button>
            <button type="button" className={`filter-chip ${workflowFilter === "all" ? "active" : ""}`} onClick={() => setWorkflowFilter("all")}>All <span>{scopedCases.length}</span></button>
          </div>
        </div>
        <div className="reimbursement-filter-group">
          <small>Sources</small>
          <div className="reimbursement-filter-chips">
            <button type="button" className={`filter-chip ${sourceFilter === "all" ? "active" : ""}`} onClick={() => setSourceFilter("all")}>All <span>{scopedCases.length}</span></button>
            <button type="button" className={`filter-chip ${sourceFilter === "email" ? "active" : ""}`} onClick={() => setSourceFilter("email")}>Email <span>{filterCounts.email}</span></button>
            <button type="button" className={`filter-chip ${sourceFilter === "blue-cross" ? "active" : ""}`} onClick={() => setSourceFilter("blue-cross")}>Blue Cross <span>{filterCounts.blueCross}</span></button>
            <button type="button" className={`filter-chip ${sourceFilter === "desjardins" ? "active" : ""}`} onClick={() => setSourceFilter("desjardins")}>Desjardins <span>{filterCounts.desjardins}</span></button>
          </div>
        </div>
        <div className="reimbursement-filter-group">
          <small>Reimbursement detail</small>
          <div className="reimbursement-filter-chips">
            <button type="button" className={`filter-chip ${filters.has("fully-reimbursed") ? "active" : ""}`} aria-pressed={filters.has("fully-reimbursed")} onClick={() => toggleFilter("fully-reimbursed")}>
              Fully reimbursed <span>{filterCounts.fully}</span>
            </button>
            <button type="button" className={`filter-chip ${filters.has("not-fully-reimbursed") ? "active" : ""}`} aria-pressed={filters.has("not-fully-reimbursed")} onClick={() => toggleFilter("not-fully-reimbursed")}>
              Not fully reimbursed <span>{filterCounts.outstanding}</span>
            </button>
            <button type="button" className={`filter-chip ${filters.has("primary") ? "active" : ""}`} aria-pressed={filters.has("primary")} onClick={() => toggleFilter("primary")}>
              Primary <span>{filterCounts.primary}</span>
            </button>
            <button type="button" className={`filter-chip ${filters.has("secondary") ? "active" : ""}`} aria-pressed={filters.has("secondary")} onClick={() => toggleFilter("secondary")}>
              Secondary <span>{filterCounts.secondary}</span>
            </button>
          </div>
        </div>
        <div className="reimbursement-filter-panel-footer">
          <span>Open / Closed / Ignore can also be changed directly on each reimbursement card.</span>
          <button type="button" className="mini-button" onClick={() => setFiltersOpen(false)}>Done</button>
        </div>
      </div>}
    </section>

    <section className="reimbursement-history" aria-labelledby="reimbursement-history-title">
      <div className="reimbursement-history-heading">
        <h2 id="reimbursement-history-title">{workflowFilter === "all" ? "All" : workflowFilter[0].toUpperCase() + workflowFilter.slice(1)} invoices · {scopeLabel}</h2>
        <span>{filteredCases.length}</span>
      </div>
      {selectableVisibleCases.length > 0 && <div className="claims-bulk-actions" role="toolbar" aria-label="Bulk claim actions">
        <label className="claims-select-all">
          <input type="checkbox" checked={allVisibleSelected}
            onChange={() => setSelectedClaimIds(allVisibleSelected ? new Set() : new Set(selectableVisibleCases.map(item => item.Id)))} />
          <span>{allVisibleSelected ? "Clear visible" : "Select all visible"}</span>
        </label>
        {selectedVisibleCount > 0 && <>
          <span className="claims-selected-count">{selectedVisibleCount} selected</span>
          <button type="button" className="mini-button danger" disabled={!paired || bulkIgnoring || !!savingId || busy}
            onClick={() => void ignoreSelectedClaims(selectableVisibleCases)}>
            {bulkIgnoring ? "Ignoring…" : `Ignore selected (${selectedVisibleCount})`}
          </button>
        </>}
      </div>}

      {!model.cases.length && <div className="empty-state reimbursement-empty"><CircleDollarSign size={30} /><strong>No healthcare expenses yet</strong><span>Run the PC collection after importing invoices and insurer statements.</span></div>}
      {!!model.cases.length && !filteredCases.length && <div className="empty-state reimbursement-empty"><strong>No invoices match these filters</strong><span>Change the workflow, person or source filters to continue the review.</span></div>}

      <div className="expense-list">
        {filteredCases.map(item => {
          const status = reimbursementCaseStatus(item);
          const matchAssignments = item.MatchAssignments ?? [];
          const matchConfidence = matchAssignments.length
            ? Math.round(item.MatchConfidence ?? Math.min(...matchAssignments.map(match => match.Confidence)))
            : null;
          const manuallyConfirmed = matchAssignments.length > 0 && matchAssignments.every(match => match.Verification === "confirmed-manually");
          const reviewRecommended = matchAssignments.some(match => match.Verification === "review-recommended");
          const matchExpanded = expandedMatchId === item.Id;
          const workflow = reimbursementWorkflowStatus(item);
          const workflowSavingId = `workflow:${item.ExpenseDocumentId || item.ExpenseDocumentIds?.[0] || item.DocumentIds[0]}`;
          const workflowSaving = savingId === workflowSavingId;
          const workflowValue: ReimbursementWorkflowStatus | "automatic" = item.WorkflowOrigin === "manual" ? workflow : "automatic";
          const insurerOrderUnknown = !item.PrimaryInsurer && !item.SecondaryInsurer
            && (item.Member === "Nathan" || matchAssignments.some(match => match.Insurer === "desjardins" || match.Insurer === "blue-cross"));
          const firstInsurerLabel = insurerOrderUnknown ? "Desjardins" : item.PrimaryInsurer || "Primary";
          const secondInsurerLabel = insurerOrderUnknown ? "Blue Cross" : item.SecondaryInsurer || "Secondary";
          const firstInsurerAmount = insurerOrderUnknown
            ? namedInsurerReimbursementAmount(item, "Desjardins", invoiceById) : primaryReimbursementAmount(item);
          const secondInsurerAmount = insurerOrderUnknown
            ? namedInsurerReimbursementAmount(item, "Blue Cross", invoiceById) : secondaryReimbursementAmount(item);
          const sameDayUnmatched = !item.InferredFromInsurer && item.ServiceDate ? model.unmatched.filter(({ item: candidate }) =>
            candidate.Member === item.Member && candidate.ServiceDate?.slice(0, 10) === item.ServiceDate?.slice(0, 10)) : [];
          const invoicePdfOptions = reimbursementInvoicePdfOptions(item, invoiceById);
          const evidenceSources = reimbursementEvidenceSources(item, invoiceById);
          const actionLabel = reimbursementActionLabel(item);
          const selectable = !item.InferredFromInsurer && workflow !== "ignore" && Boolean(workflowExpenseId(item));
          const selected = selectedClaimIds.has(item.Id);
          return <article className={`expense-card ${item.InferredFromInsurer ? "insurer-inferred" : ""} ${selected ? "bulk-selected" : ""}`} key={item.Id}>
            <div className="expense-heading">
              {selectable && <label className="claim-select-control" aria-label="Select claim for bulk action">
                <input type="checkbox" checked={selected} onChange={() => setSelectedClaimIds(previous => {
                  const next = new Set(previous);
                  if (next.has(item.Id)) next.delete(item.Id); else next.add(item.Id);
                  return next;
                })} />
              </label>}
              <div><strong>{healthcareTitle(item)}</strong><small>{item.Member === "unknown" ? "Person to confirm" : item.Member}{item.ServiceType && healthcareTitle(item) !== item.ServiceType ? ` · ${item.ServiceType}` : ""}{item.ServiceDate ? ` · ${dateLabel(item.ServiceDate)}` : invoiceById.get(item.DocumentIds[0])?.ReceivedAt ? ` · Received ${dateLabel(invoiceById.get(item.DocumentIds[0])!.ReceivedAt)}` : " · Date missing"}</small></div>
              <div className="expense-status-stack">
                <span className={`workflow-status ${workflow}`}>{workflow === "open" ? "Open" : workflow === "closed" ? "Closed" : "Ignore"}</span>
                <span className={`reimbursement-status ${item.PreviouslyFound ? "needs-attention" : status}`}>{item.PreviouslyFound ? "Verify source" : <>{status === "fully-reimbursed" && <CheckCircle2 size={14} />}{statusCopy[status]}</>}</span>
              </div>
            </div>
            <div className="expense-source-row" aria-label="Evidence sources">
              <span className="expense-source-label">Sources</span>
              {evidenceSources.map(source => <span className={`expense-source-badge ${source === "Email" ? "email" : source === "Blue Cross" ? "blue-cross" : "desjardins"}`} key={source}>{source}</span>)}
              {item.OriginalInvoiceMissing && <span className="expense-source-note">Original invoice missing</span>}
            </div>
            <div className={`expense-action-state ${workflow}`}>
              <strong>{actionLabel}</strong>
              {item.OriginalInvoiceMissing && <small>Insurer evidence establishes the expense even though the original email/receipt was not found.</small>}
            </div>
            <div className="expense-amounts">
              <div><small>Expense</small><strong>{money(item.OriginalAmount, item.Currency)}</strong></div>
              <div><small>{firstInsurerLabel}</small><strong>{money(firstInsurerAmount, item.Currency)}</strong></div>
              <div><small>{secondInsurerLabel}</small><strong>{money(secondInsurerAmount, item.Currency)}</strong></div>
              <div className="remaining"><small>Remaining</small><strong>{money(item.PotentialRemaining, item.Currency)}</strong></div>
            </div>
            {item.InferredFromInsurer ? <div className="workflow-control projected-workflow">
              <div>
                <strong>Workflow</strong>
                <small>Automatic from insurer evidence · source data is unchanged</small>
              </div>
              <span className={`workflow-status ${workflow}`}>{workflow === "closed" ? "Closed" : "Open"}</span>
            </div> : <div className="workflow-control">
              <div>
                <strong>Workflow</strong>
                <small>{item.WorkflowOrigin === "manual" ? "Manual override" : "Automatic"}{item.WorkflowChangedAt ? ` · ${new Date(item.WorkflowChangedAt).toLocaleString()}` : ""}</small>
              </div>
              <select aria-label="Reimbursement workflow status" value={workflowValue} disabled={!paired || !!savingId || busy}
                onChange={event => void changeWorkflow(item, event.target.value as ReimbursementWorkflowStatus | "automatic")}>
                <option value="automatic">Automatic ({item.AutomaticWorkflowStatus === "closed" ? "Closed" : "Open"})</option>
                <option value="open">Open manually</option>
                <option value="closed">Closed manually</option>
                <option value="ignore">Ignore manually</option>
              </select>
              {workflowSaving && <span className="workflow-saving">Saving…</span>}
            </div>}
            {!!item.WorkflowHistory?.length && <details className="workflow-history">
              <summary>Status history</summary>
              <div>{[...item.WorkflowHistory].slice(-6).reverse().map((entry, index) =>
                <p key={`${entry.At}:${index}`}><strong>{entry.Status === "open" ? "Open" : entry.Status === "closed" ? "Closed" : "Ignore"}</strong>
                  <span>{entry.Origin === "manual" ? "Manual" : "Automatic"} · {new Date(entry.At).toLocaleString()}</span></p>)}</div>
            </details>}
            {sameDayUnmatched.length > 0 && <div className="manual-match-candidates">
              <div className="manual-match-candidates-heading">
                <strong>Unmatched same-day reimbursements</strong>
                <small>{sameDayUnmatched.length} candidate{sameDayUnmatched.length === 1 ? "" : "s"} · same person and service date</small>
              </div>
              {sameDayUnmatched.map(({ result, item: candidate }) => {
                const candidateSaving = savingId === `manual-match:${candidate.Id}` || savingId === `unmatched-ignore:${candidate.Id}`;
                const service = candidate.Healthcare?.ServiceType || candidate.ClaimedService || candidate.Provider || "Service not identified";
                return <div className="manual-match-candidate" key={candidate.Id}>
                  <div className="manual-match-candidate-main">
                    <div>
                      <strong>{candidate.Insurer === "desjardins" ? "Desjardins" : candidate.Insurer === "blue-cross" ? "Blue Cross" : "Insurer unknown"}</strong>
                      <span>{dateLabel(candidate.ServiceDate || candidate.ReceivedAt)} · {service}</span>
                      <small>{candidate.Provider && candidate.Provider !== service ? `${candidate.Provider} · ` : ""}{unmatchedReason(result)}</small>
                    </div>
                    <strong>{money(reimbursementAmount(candidate), candidate.Currency || item.Currency)}</strong>
                  </div>
                  <div className="match-actions">
                    <button type="button" className="mini-button" disabled={!paired || !manualActionsAvailable || !!savingId || busy}
                      onClick={() => void matchUnmatched(item, candidate.Id)}>{candidateSaving ? "Saving…" : manualActionsAvailable ? "Match to this expense" : "Update PC worker"}</button>
                    <button type="button" className="mini-button subtle" disabled={!paired || !manualActionsAvailable || !!savingId || busy}
                      onClick={() => void changeUnmatchedIgnored(candidate.Id, true)}>{candidateSaving ? "Saving…" : manualActionsAvailable ? "Ignore" : "Update PC worker"}</button>
                  </div>
                </div>;
              })}
            </div>}
            {matchAssignments.length > 0 && <div className="match-summary">
              <button type="button" className={`match-confidence-button ${reviewRecommended ? "review" : manuallyConfirmed ? "confirmed" : ""}`}
                aria-expanded={matchExpanded} onClick={() => setExpandedMatchId(matchExpanded ? "" : item.Id)}>
                <CheckCircle2 size={15} />
                <span>Insurer link · {matchConfidence}%</span>
                {manuallyConfirmed && <small>Confirmed manually</small>}
                {!manuallyConfirmed && reviewRecommended && <small>Review</small>}
              </button>
              {matchExpanded && <div className="match-details">
                <div className="match-details-heading"><strong>Why FamilyHub linked this insurer record</strong><span>Link confidence is separate from document extraction confidence.</span></div>
                {matchAssignments.map(match => {
                  const reimbursement = invoiceById.get(match.ReimbursementDocumentId);
                  const isSaving = savingId === `match:${match.ReimbursementDocumentId}`;
                  return <div className="match-detail-row" key={match.ReimbursementDocumentId}>
                    <div className="match-detail-main">
                      <div><strong>{match.Insurer === "desjardins" ? "Desjardins" : match.Insurer === "blue-cross" ? "Blue Cross" : reimbursement?.Provider || "Insurer record"}</strong>
                        <span>{Math.round(match.Confidence)}% link confidence{match.Verification === "confirmed-manually" ? " · Confirmed manually" : match.Verification === "review-recommended" ? " · Review recommended" : " · Auto-linked"}</span></div>
                      <strong>{money(reimbursementAmount(reimbursement ?? {} as ReimbursementItem), reimbursement?.Currency || item.Currency)}</strong>
                    </div>
                    <div className="match-evidence">{match.Evidence.map((evidence, index) => <span key={index}>✓ {evidence}</span>)}</div>
                    <div className="match-actions">
                      {match.Verification === "review-recommended" && <button type="button" className="mini-button" disabled={!paired || !!savingId || busy}
                        onClick={() => void decideMatch(match, "confirmed")}>{isSaving ? "Saving…" : "Confirm match"}</button>}
                      <button type="button" className="mini-button subtle" disabled={!paired || !!savingId || busy}
                        onClick={() => void decideMatch(match, "rejected")}>{isSaving ? "Saving…" : "Reject match"}</button>
                    </div>
                  </div>;
                })}
              </div>}
            </div>}
            {!!item.UnallocatedReimbursedAmount && <p className="privacy-note expense-warning">Insurer order to confirm · known payments are shown by insurer above.</p>}
            {item.PreviouslyFound && <p className="privacy-note expense-warning">{item.Unreconciled
              ? "Indexed invoice without a reconciliation case. Check the source before relying on its amounts or reimbursement status."
              : "Previously found invoice; the latest PC result did not include it. Check the source before relying on its amounts or reimbursement status."}</p>}
            {invoicePdfOptions.length === 1 && <div className="expense-document-actions">
              {invoicePdfOptions[0].Source === "drive" && invoicePdfOptions[0].Url
                ? <a className="mini-button" href={invoicePdfOptions[0].Url} target="_blank" rel="noreferrer">
                    <ExternalLink size={14} /> View invoice
                  </a>
                : <button type="button" className="mini-button" disabled={!paired || !!savingId || busy}
                    onClick={() => void openInvoicePdf(invoicePdfOptions[0])}>
                    <ExternalLink size={14} />{savingId === `pdf:${invoicePdfOptions[0].ItemId}:${invoicePdfOptions[0].AttachmentIndex}` ? " Opening…" : " View invoice"}
                  </button>}
            </div>}
            {invoicePdfOptions.length > 1 && <details className="expense-document-actions invoice-pdf-picker">
              <summary className="mini-button"><ExternalLink size={14} /> View invoice <span>{invoicePdfOptions.length}</span></summary>
              <div className="invoice-pdf-options">
                {invoicePdfOptions.map((option, index) => option.Source === "drive" && option.Url
                  ? <a className="invoice-pdf-option" href={option.Url} target="_blank" rel="noreferrer" key={`${option.ItemId}:${option.AttachmentIndex}`}>
                      <span>{option.FileName || `Invoice PDF ${index + 1}`}</span><ExternalLink size={14} />
                    </a>
                  : <button type="button" className="invoice-pdf-option" disabled={!paired || !!savingId || busy}
                      onClick={() => void openInvoicePdf(option)} key={`${option.ItemId}:${option.AttachmentIndex}`}>
                      <span>{option.FileName || `Invoice PDF ${index + 1}`}</span><ExternalLink size={14} />
                    </button>)}
              </div>
            </details>}
            <div className="expense-note"><span>{item.Summary}</span><small>{matchAssignments.length ? `${matchAssignments.length} insurer source record${matchAssignments.length === 1 ? "" : "s"} linked` : `Source confidence ${Math.round(item.Confidence)}%`}</small></div>
            {item.Status === "needs-attention" && item.DocumentIds[0] && reviews.get(`case:${item.DocumentIds[0]}`) &&
              <p className="privacy-note expense-warning">Second AI review: {reviews.get(`case:${item.DocumentIds[0]}`)!.explanation} · Suggestion only; check the source documents.</p>}
          </article>;
        })}
      </div>
    </section>

    </> : <ReconciliationQueue
      items={hub.reimbursements.Items}
      cases={model.cases}
      unmatched={scopedUnmatched}
      ignoredUnmatched={scopedIgnoredUnmatched}
      personScope={personScope}
      paired={paired}
      manualActionsAvailable={manualActionsAvailable}
      busy={busy}
      savingId={savingId}
      onPersonScopeChange={selectScope}
      onMatch={matchUnmatched}
      onIgnore={changeUnmatchedIgnored}
    />}
  </div>;
}
