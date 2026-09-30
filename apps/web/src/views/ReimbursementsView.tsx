import { useEffect, useMemo, useRef, useState } from "react";
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
import ClaimCard from "./ClaimCard";
import PrepareClaim from "./PrepareClaim";
import { FilterButton, FilterChips, Notice, PageHeader, SearchField, Sheet, SkeletonList, useSessionValue, type ActiveFilter } from "../ui/primitives";
import { useMutations } from "../ui/use-mutations";
import { requireSaved } from "../ui/mutation-queue";

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
  const [preparingExpense, setPreparingExpense] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lastSuccess, setLastSuccess] = useState("");
  const [savingId, setSavingId] = useState("");
  const [savedMessage, setSavedMessage] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [query, setQuery] = useSessionValue("claims.query", "", (value): value is string => typeof value === "string");
  const refreshEpoch = useRef(0);
  const [selectedClaimIds, setSelectedClaimIds] = useState<Set<string>>(() => new Set());
  const [bulkIgnoring, setBulkIgnoring] = useState(false);
  const [savedFilters, setSavedFilters] = useSessionValue<InvoiceHistoryFilter[]>("claims.details", [], (value): value is InvoiceHistoryFilter[] => Array.isArray(value) && value.every(item => ["fully-reimbursed", "not-fully-reimbursed", "primary", "secondary"].includes(item)));
  const filters = useMemo(() => new Set(savedFilters), [savedFilters]);
  const setFilters = (next: Set<InvoiceHistoryFilter> | ((previous: Set<InvoiceHistoryFilter>) => Set<InvoiceHistoryFilter>)) => setSavedFilters(previous => [...(typeof next === "function" ? next(new Set(previous)) : next)]);
  const [personScope, setPersonScope] = useSessionValue<ReimbursementPersonScope>("claims.person", "all", (value): value is ReimbursementPersonScope => ["all", "Kevin", "Jasmine", "Nathan"].includes(value as string));
  const [workflowFilter, setWorkflowFilter] = useSessionValue<WorkflowStatusFilter>("claims.workflow", "open", (value): value is WorkflowStatusFilter => ["all", "open", "closed", "ignore"].includes(value as string));
  const [sourceFilter, setSourceFilter] = useSessionValue<"all" | "email" | "blue-cross" | "desjardins">("claims.source", "all", (value): value is "all" | "email" | "blue-cross" | "desjardins" => ["all", "email", "blue-cross", "desjardins"].includes(value as string));
  const [startDate, setStartDate] = useSessionValue("claims.startDate", "", (value): value is string => typeof value === "string");
  const [endDate, setEndDate] = useSessionValue("claims.endDate", "", (value): value is string => typeof value === "string");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [workerVersion, setWorkerVersion] = useState("");
  const [screen, setScreen] = useSessionValue<"claims" | "reconcile">("claims.screen", "claims", (value): value is "claims" | "reconcile" => value === "claims" || value === "reconcile");
  const [blueCrossStatus, setBlueCrossStatus] = useState<BlueCrossSyncStatus | null>(null);
  const [blueCrossResult, setBlueCrossResult] = useState<BlueCrossSyncResult | null>(null);
  const [blueCrossBusy, setBlueCrossBusy] = useState(false);
  const [desjardinsStatus, setDesjardinsStatus] = useState<DesjardinsSyncStatus | null>(null);
  const [desjardinsResult, setDesjardinsResult] = useState<DesjardinsSyncResult | null>(null);
  const [desjardinsBusy, setDesjardinsBusy] = useState(false);
  const paired = Boolean(hub.worker.Endpoint.trim() && hub.worker.ApiKey.trim());
  const manualActionsAvailable = !workerVersion || workerVersionAtLeast(workerVersion, manualReconciliationWorkerVersion);

  async function refresh(quiet = false) {
    if (!paired) return;
    const epoch = ++refreshEpoch.current;
    if (!quiet) { setBusy(true); setError(""); }
    try {
      const snapshot = await fetchInvoices(hub.worker);
      if (epoch !== refreshEpoch.current) return;
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
      if (epoch !== refreshEpoch.current) return;
      if (quiet) throw err;
      setError(err instanceof Error ? err.message : "The PC results could not be refreshed.");
    } finally { if (!quiet && epoch === refreshEpoch.current) setBusy(false); }
  }

  const { pending, pendingFor, queue } = useMutations({
    refresh: () => refresh(true),
    saved: count => setSavedMessage(`${count === 1 ? "Change" : `${count} changes`} saved on the PC.`),
    error: message => setError(message)
  });

  async function saveChange(key: string, label: string, action: () => Promise<{ saved: boolean }>) {
    if (!paired || bulkIgnoring) return false;
    // Invalidate an older read before a mutation, without guessing financial facts.
    if (!queue.busy) { ++refreshEpoch.current; setBusy(false); }
    setError(""); setSavedMessage("");
    return queue.enqueue(key, label, async () => requireSaved(await action()));
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
    await saveChange(`match:${assignment.ReimbursementDocumentId}`, decision === "confirmed" ? "Confirm match" : "Reject match",
      () => setMatchDecision(hub.worker, assignment.ReimbursementDocumentId, assignment.ExpenseDocumentId, decision));
  }
  async function matchUnmatched(item: ReconciliationCase, reimbursementId: string) {
    const expenseId = workflowExpenseId(item);
    if (!expenseId) return false;
    return saveChange(`manual-match:${reimbursementId}`, "Match", () => setManualMatch(hub.worker, reimbursementId, expenseId));
  }
  async function changeUnmatchedIgnored(reimbursementId: string, ignored: boolean) {
    return saveChange(`unmatched-ignore:${reimbursementId}`, ignored ? "Ignore" : "Restore", () => setUnmatchedIgnored(hub.worker, reimbursementId, ignored));
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
    if (!paired || bulkIgnoring || queue.busy) return;
    const targets = items.filter(item => workflowExpenseId(item) && reimbursementWorkflowStatus(item) !== "ignore" && selectedClaimIds.has(item.Id));
    if (!targets.length || !window.confirm(`Ignore ${targets.length} selected claims? Their evidence is kept and you can restore them from the Ignored filter.`)) return;
    ++refreshEpoch.current; setBusy(false);
    setBulkIgnoring(true); setError(""); setSavedMessage("");
    let saved = 0;
    try {
      // Enqueue the complete visible selection. Partial failures do not erase the remaining selection.
      await Promise.all(targets.map(item => queue.enqueue(`workflow:${workflowExpenseId(item)}`, "Ignore", async () => {
        const expenseId = workflowExpenseId(item)!;
        requireSaved(item.InferredFromInsurer ? await setUnmatchedIgnored(hub.worker, expenseId, true) : await setReimbursementWorkflowStatus(hub.worker, expenseId, "ignore"));
        saved++;
        setSelectedClaimIds(previous => { const next = new Set(previous); next.delete(item.Id); return next; });
      })));
      if (saved !== targets.length) setError(`${saved} of ${targets.length} claims were ignored. Unconfirmed changes remain selected; check the connection and refresh before retrying.`);
    } finally { setBulkIgnoring(false); }
  }

  async function changeWorkflow(item: ReconciliationCase, status: ReimbursementWorkflowStatus | "automatic") {
    const expenseId = workflowExpenseId(item);
    if (!expenseId) return;
    if (item.InferredFromInsurer && status !== "ignore" && status !== "automatic") {
      setError("This insurer-only claim supports Automatic or Ignore until an original expense is available."); return;
    }
    await saveChange(`workflow:${expenseId}`, status[0].toUpperCase() + status.slice(1), () => item.InferredFromInsurer
      ? setUnmatchedIgnored(hub.worker, expenseId, status === "ignore")
      : setReimbursementWorkflowStatus(hub.worker, expenseId, status));
  }

  const model = useMemo(() => {
    const byId = new Map(hub.reimbursements.Items.map(item => [item.Id, item]));
    const ignoredCases = (hub.reimbursements.IgnoredExpenses ?? []).map(item => ({
      ...item,
      WorkflowStatus: item.WorkflowStatus ?? "ignore" as const,
      WorkflowOrigin: item.WorkflowOrigin ?? "manual" as const
    }));
    const baseCases = [...(hub.reimbursements.Reconciliations ?? []), ...ignoredCases];
    const inferenceSources = [...(hub.reimbursements.UnmatchedReimbursements ?? []), ...(hub.reimbursements.IgnoredUnmatchedReimbursements ?? [])]
      .filter((item, index, all) => all.findIndex(candidate => candidate.DocumentId === item.DocumentId) === index);
    const inferredCases = insurerEvidenceExpenseCases(baseCases, inferenceSources, hub.reimbursements.Items);
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
    + (sourceFilter === "all" ? 0 : 1)
    + (startDate ? 1 : 0)
    + (endDate ? 1 : 0);
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
    const source = sourceFilter === "email" ? "Email" : sourceFilter === "blue-cross" ? "Blue Cross" : sourceFilter === "desjardins" ? "Desjardins" : null;
    return history.filter(item => {
      if (source && !reimbursementEvidenceSources(item, invoiceById).includes(source)) return false;
      if (query.trim() && ![healthcareTitle(item), item.Member, item.ServiceType, item.ServiceDate, item.Summary].filter(Boolean).join(" ").toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) return false;
      const serviceDay = item.ServiceDate?.slice(0, 10)
        || invoiceById.get(item.DocumentIds[0])?.ReceivedAt?.slice(0, 10)
        || "";
      if (startDate && (!serviceDay || serviceDay < startDate)) return false;
      if (endDate && (!serviceDay || serviceDay > endDate)) return false;
      return true;
    });
  }, [endDate, filters, invoiceById, query, sourceFilter, startDate, workflowScopedCases]);

  const selectableVisibleCases = useMemo(() => filteredCases.filter(item =>
    reimbursementWorkflowStatus(item) !== "ignore" && Boolean(workflowExpenseId(item))),
    [filteredCases]);
  const selectedVisibleCount = selectableVisibleCases.filter(item => selectedClaimIds.has(item.Id)).length;
  const allVisibleSelected = selectableVisibleCases.length > 0 && selectedVisibleCount === selectableVisibleCases.length;

  useEffect(() => {
    const visible = new Set(selectableVisibleCases.map(item => item.Id));
    setSelectedClaimIds(previous => new Set([...previous].filter(id => visible.has(id))));
  }, [selectableVisibleCases.map(item => item.Id).join("|")]);

  const scopeLabel = personScope === "all" ? "All family" : personScope;

  function selectScope(scope: ReimbursementPersonScope) {
    setQuery("");
    setPersonScope(scope);
    setWorkflowFilter("open");
    setSourceFilter("all");
    setStartDate(""); setEndDate("");
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

  function resetFilters() { setFilters(new Set<InvoiceHistoryFilter>()); setWorkflowFilter("open"); setSourceFilter("all"); setStartDate(""); setEndDate(""); setQuery(""); }
  const detailLabels: Record<InvoiceHistoryFilter, string> = { "fully-reimbursed": "Fully reimbursed", "not-fully-reimbursed": "Not fully reimbursed", primary: "Primary paid", secondary: "Secondary paid" };
  const activeChips: ActiveFilter[] = [
    ...(sourceFilter !== "all" ? [{ id: "source", label: sourceFilter === "email" ? "Email" : sourceFilter === "blue-cross" ? "Blue Cross" : "Desjardins", clear: () => setSourceFilter("all") }] : []),
    ...(startDate ? [{ id: "start", label: `From ${startDate}`, clear: () => setStartDate("") }] : []),
    ...(endDate ? [{ id: "end", label: `Through ${endDate}`, clear: () => setEndDate("") }] : []),
    ...[...filters].map(filter => ({ id: filter, label: detailLabels[filter], clear: () => toggleFilter(filter) }))
  ];

  return <div className="view-stack reimbursement-app-view">
    {preparingExpense && <PrepareClaim expenseId={preparingExpense} config={hub.worker} onClose={() => setPreparingExpense("")} />}
    <PageHeader title="Claims" subtitle={paired ? lastSuccess ? `Updated ${new Date(lastSuccess).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Saved results" : "Saved on this device"}>
      <button type="button" className="button secondary" onClick={() => setSourcesOpen(true)} aria-haspopup="dialog">Sources{blueCrossStatus?.state === "error" || desjardinsStatus?.state === "error" || blueCrossStatus?.state === "login-required" || desjardinsStatus?.state === "login-required" ? " · !" : ""}</button>
      <button type="button" className="icon-button" aria-label="Refresh reimbursements" disabled={!paired || busy || pending.length > 0 || bulkIgnoring} onClick={() => void refresh()}><RefreshCw size={18} className={busy ? "spin" : ""} /></button>
    </PageHeader>
    <Sheet open={sourcesOpen} onClose={() => setSourcesOpen(false)} title="Sources & sync" description="Refresh reads saved results. Portal collection and apply remain manual.">
      <div className="source-tools">
    <section className="bluecross-sync" aria-label="Blue Cross portal sync">
      <button type="button" className="button secondary compact-button" disabled={!paired || pending.length > 0 || blueCrossBusy || !!workerVersion && !workerVersionAtLeast(workerVersion, "2.9.0")}
        onClick={() => void runBlueCrossSync(false)}>{blueCrossBusy ? "Synchronisation Blue Cross…" : "Mettre à jour Blue Cross"}</button>
      {blueCrossResult?.status === "success" && blueCrossResult.complete && !blueCrossResult.applied && !blueCrossResult.ambiguous &&
        <button type="button" className="button secondary compact-button" disabled={blueCrossBusy || pending.length > 0} onClick={() => void runBlueCrossSync(true)}>Appliquer Blue Cross</button>}
      <small role="status">{blueCrossResult?.status === "login-required" || blueCrossStatus?.state === "login-required" ? "Connexion Blue Cross requise sur le PC (commande --login)."
        : blueCrossResult?.status === "success" ? `${blueCrossResult.new ?? 0} nouveaux · ${blueCrossResult.changed ?? 0} mis à jour · ${blueCrossResult.unchanged ?? 0} inchangés${blueCrossResult.complete ? "" : " · collecte incomplète"}${blueCrossResult.applied ? ` · ${blueCrossResult.unmatched ?? 0} à réconcilier` : " · aperçu seulement"}`
        : blueCrossStatus?.state === "error" ? `Erreur Blue Cross : ${blueCrossStatus.error || "échec de la synchronisation"}`
        : blueCrossStatus?.lastSuccess ? `${blueCrossStatus.state === "up-to-date" ? "À jour" : "Aperçu disponible"} · ${blueCrossStatus.found ?? 0} lignes · dernière collecte ${new Date(blueCrossStatus.lastSuccess).toLocaleString()}`
        : "Synchronisation manuelle · aucun historique Blue Cross synchronisé"}</small>
      {blueCrossStatus?.lastAttempt && <small>Dernière tentative : {new Date(blueCrossStatus.lastAttempt).toLocaleString()}</small>}
    </section>

    <section className="bluecross-sync" aria-label="Desjardins portal sync">
      <button type="button" className="button secondary compact-button" disabled={!paired || pending.length > 0 || desjardinsBusy || !!workerVersion && !workerVersionAtLeast(workerVersion, "2.10.0")}
        onClick={() => void runDesjardinsSync(false)}>{desjardinsBusy ? "Synchronisation Desjardins…" : "Mettre à jour Desjardins"}</button>
      {desjardinsStatus?.applicable && desjardinsStatus.previewAt && Date.now() - Date.parse(desjardinsStatus.previewAt) < 24 * 60 * 60_000 &&
        <button type="button" className="button secondary compact-button" disabled={desjardinsBusy || pending.length > 0} onClick={() => void runDesjardinsSync(true)}>Appliquer Desjardins</button>}
      <small role="status">{desjardinsResult?.status === "login-required" || desjardinsStatus?.state === "login-required" ? "Connexion Desjardins requise sur le PC (commande --login)."
        : desjardinsResult?.status === "success" ? `${desjardinsResult.new ?? 0} nouveaux · ${desjardinsResult.changed ?? 0} mis à jour · ${desjardinsResult.unchanged ?? 0} inchangés${desjardinsResult.ambiguous ? ` · ${desjardinsResult.ambiguous} à vérifier` : ""}${desjardinsResult.complete ? "" : " · collecte incomplète"}${desjardinsResult.applied ? ` · ${desjardinsResult.unmatched ?? 0} à réconcilier` : " · aperçu seulement"}`
        : desjardinsStatus?.state === "error" ? `Erreur Desjardins : ${desjardinsStatus.error || "échec de la synchronisation"}`
        : desjardinsStatus?.lastSuccess ? `${desjardinsStatus.state === "up-to-date" ? "À jour" : "Aperçu disponible"} · ${desjardinsStatus.found ?? 0} lignes · dernière collecte ${new Date(desjardinsStatus.lastSuccess).toLocaleString()}`
        : "Synchronisation manuelle · aucun historique Desjardins synchronisé"}</small>
      {desjardinsStatus?.lastAttempt && <small>Dernière tentative : {new Date(desjardinsStatus.lastAttempt).toLocaleString()}</small>}
    </section>

        <details className="data-coverage"><summary>Invoice-search coverage</summary><p>{hub.reimbursements.InvoiceCoverage?.complete
          ? "Potential invoice search completed since June 1, 2025 for connected accounts. Scanned images and unreadable attachments may still need review."
          : "Historical collection since June 1, 2025 is not yet confirmed complete. Run the PC collection to resume it."} Insurance coverage is not confirmed by a receipt.</p></details>
        {!paired && <p className="privacy-note">Connect your PC in Other → Settings & tools to refresh or update sources. Saved records remain available offline.</p>}
      </div>
    </Sheet>

    {error && <Notice error onDismiss={() => setError("")}>{error}</Notice>}
    {workerVersion && !manualActionsAvailable && <div className="banner error" role="status"><AlertTriangle size={17} />PC worker {workerVersion} is outdated for manual reimbursement matching. Update/restart the FamilyHub worker to {manualReconciliationWorkerVersion} or later, then refresh this page.</div>}
    {savedMessage && <Notice onDismiss={() => setSavedMessage("")}>{savedMessage}</Notice>}
    {model.warnings.length > 0 && <details className="source-notices"><summary>Source notes · {model.warnings.length}</summary>
      {model.warnings.map(warning => <p key={warning}>{warning}</p>)}
    </details>}

    <section className="reimbursement-mode-tabs" aria-label="Claims workspace">
      <button type="button" className={screen === "claims" ? "active" : ""} aria-pressed={screen === "claims"} onClick={() => setScreen("claims")}>
        Claims
      </button>
      <button type="button" className={screen === "reconcile" ? "active" : ""} aria-pressed={screen === "reconcile"} onClick={() => setScreen("reconcile")}>
        À réconcilier <span>{model.unmatched.length}</span>
      </button>
    </section>

    {screen === "claims" ? <>
    <div className="claim-scope-summary">
    <section className="reimbursement-family-scopes" aria-label="Reimbursements by family member">
      {(["all", "Kevin", "Jasmine", "Nathan"] as ReimbursementPersonScope[]).map(scope => {
        const summary = scopeSummaries.get(scope)!;
        const label = scope === "all" ? "All family" : scope;
        return <button type="button" key={scope} className={`family-scope-card ${personScope === scope ? "active" : ""}`}
          aria-pressed={personScope === scope} onClick={() => selectScope(scope)}>
          <span className="scope-person">{label} <b>{summary.open}<span className="sr-only"> open cases</span></b></span>
          <span className="scope-recovery">{summary.knownAmounts ? money(summary.potentiallyRecoverable) : summary.open ? "—" : money(0)}{summary.unknownAmounts > 0 ? " + ?" : ""}</span>
          <span className="sr-only">potentially recoverable{summary.unknownAmounts > 0 ? `; ${summary.unknownAmounts} amounts to confirm` : ""}</span>
        </button>;
      })}
    </section>

    <details className="reimbursement-totals">
      <summary>
        <span><small>Potential to recover</small><strong>{scopeSummaries.get(personScope)!.knownAmounts || !scopeSummaries.get(personScope)!.open ? money(scopeSummaries.get(personScope)!.potentiallyRecoverable) : "—"}{scopeSummaries.get(personScope)!.unknownAmounts > 0 ? " + ?" : ""}</strong></span>
        <span className="totals-disclosure">Totals <span aria-hidden="true">⌄</span></span>
      </summary>
      <section className="reimbursement-summary" aria-label={`${scopeLabel} reimbursement summary`}>
        <p className="privacy-note">Known remaining amounts on open cases. Eligibility is not guaranteed.{scopeSummaries.get(personScope)!.unknownAmounts > 0 ? ` ${scopeSummaries.get(personScope)!.unknownAmounts} amounts still need confirmation.` : ""}</p>
        <article className="summary-primary"><small>Total expenses</small><strong>{money(finance.totalPaid)}</strong><span>{scopeLabel}</span></article>
        <article><small>Desjardins</small><strong>{money(finance.desjardins)}</strong><span>reimbursed</span></article>
        <article><small>Blue Cross</small><strong>{money(finance.blueCross)}</strong><span>reimbursed</span></article>
        <article><small>Remaining balance</small><strong>{money(finance.outstanding)}</strong><span>{workflowLabel.toLowerCase()} workflow</span></article>
        <article className={finance.attention ? "summary-attention" : ""}><small>Needs attention</small><strong>{finance.attention}</strong><span>items</span></article>
      </section>
    </details>
    </div>

    <section className="workspace-controls" aria-label="Filter reimbursement history">
      <div className="search-filter-row"><SearchField value={query} onChange={setQuery} label="Search claims" placeholder="Search claims…" /><FilterButton count={activeFilterCount} onClick={() => setFiltersOpen(true)} /></div>
      <div className="workflow-tabs" aria-label="Claim status">{(["open", "closed", "ignore", "all"] as WorkflowStatusFilter[]).map(status =>
        <button type="button" key={status} className={workflowFilter === status ? "active" : ""} aria-pressed={workflowFilter === status} onClick={() => setWorkflowFilter(status)}>{status === "ignore" ? "Ignored" : status[0].toUpperCase() + status.slice(1)}<span>{status === "all" ? scopedCases.length : workflowCounts[status]}</span></button>)}</div>
      <FilterChips filters={activeChips} onReset={resetFilters} />
    </section>
    <Sheet open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filter claims"
      footer={<><button type="button" className="button secondary" onClick={resetFilters}>Reset</button><button type="button" className="button" onClick={() => setFiltersOpen(false)}>Show {filteredCases.length} claims</button></>}>
      <div className="filter-groups">
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
          <small>Service date</small>
          <div className="claims-date-range">
            <label><span>Start date</span><input type="date" value={startDate} max={endDate || undefined} onChange={event => setStartDate(event.target.value)} /></label>
            <label><span>End date</span><input type="date" value={endDate} min={startDate || undefined} onChange={event => setEndDate(event.target.value)} /></label>
            {(startDate || endDate) && <button type="button" className="mini-button subtle" onClick={() => { setStartDate(""); setEndDate(""); }}>Clear dates</button>}
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
      </div>
    </Sheet>

    <section className="reimbursement-history" aria-labelledby="reimbursement-history-title">
      <div className="reimbursement-history-heading">
        <h2 id="reimbursement-history-title">{filteredCases.length} claims <span>· Newest first</span></h2>
        {selectableVisibleCases.length > 0 && <button type="button" className="text-action" disabled={!paired || bulkIgnoring || pending.length > 0} onClick={() => { setSelecting(value => !value); setSelectedClaimIds(new Set()); }}>{selecting ? "Done" : "Select"}</button>}
      </div>
      {selecting && selectableVisibleCases.length > 0 && <div className="claims-bulk-actions" role="toolbar" aria-label="Bulk claim actions">
        <label className="claims-select-all">
          <input type="checkbox" checked={allVisibleSelected}
            onChange={() => setSelectedClaimIds(allVisibleSelected ? new Set() : new Set(selectableVisibleCases.map(item => item.Id)))} />
          <span>{allVisibleSelected ? "Clear visible" : "Select all visible"}</span>
        </label>
        {selectedVisibleCount > 0 && <>
          <span className="claims-selected-count">{selectedVisibleCount} selected</span>
          <button type="button" className="mini-button danger" disabled={!paired || bulkIgnoring || pending.length > 0 || busy}
            onClick={() => void ignoreSelectedClaims(selectableVisibleCases)}>
            {bulkIgnoring ? "Ignoring…" : `Ignore selected (${selectedVisibleCount})`}
          </button>
        </>}
      </div>}

      {busy && !model.cases.length && <SkeletonList />}
      {!busy && !model.cases.length && <div className="empty-state reimbursement-empty"><CircleDollarSign size={30} /><strong>No healthcare expenses yet</strong><span>Run the PC collection after importing invoices and insurer statements.</span></div>}
      {!!model.cases.length && !filteredCases.length && <div className="empty-state reimbursement-empty"><strong>No invoices match these filters</strong><span>Change the workflow, person or source filters to continue the review.</span></div>}

      <div className="expense-list">
        {filteredCases.map(item => <ClaimCard key={item.Id} item={item} invoiceById={invoiceById} unmatched={model.unmatched}
          paired={paired} manualActionsAvailable={manualActionsAvailable} busy={bulkIgnoring}
          savingId={pending[0]?.key || savingId} selecting={selecting} selected={selectedClaimIds.has(item.Id)}
          pending={pendingFor(`workflow:${workflowExpenseId(item)}`)}
          toggleSelected={() => setSelectedClaimIds(previous => { const next = new Set(previous); if (next.has(item.Id)) next.delete(item.Id); else next.add(item.Id); return next; })}
          operationError={error} operationMessage={savedMessage}
          reviewExplanation={reviews.get(`case:${item.DocumentIds[0]}`)?.explanation}
          changeWorkflow={changeWorkflow} decideMatch={decideMatch} matchUnmatched={matchUnmatched}
          changeUnmatchedIgnored={changeUnmatchedIgnored} openInvoicePdf={openInvoicePdf} prepareClaim={workerVersionAtLeast(workerVersion, "2.12.0") ? setPreparingExpense : undefined} />)}
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
      busy={busy || bulkIgnoring}
      savingId={pending[0]?.key || savingId}
      operationError={error} operationMessage={savedMessage}
      onPersonScopeChange={selectScope}
      onMatch={matchUnmatched}
      onIgnore={changeUnmatchedIgnored}
    />}
  </div>;
}
