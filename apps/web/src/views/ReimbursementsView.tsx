import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleDollarSign, ExternalLink, RefreshCw } from "lucide-react";
import { dateLabel } from "../domain";
import { googleBridge } from "../google";
import { buildInvoiceHistoryCases, filterInvoiceHistoryCases, filterReimbursementWorkflowCases, healthcareTitle, mergeInvoiceItems, mergeReconciliationHistory, primaryReimbursementAmount, reimbursementCaseStatus, reimbursementWorkflowStatus, reimbursementWorkflowSummary, secondaryReimbursementAmount } from "../invoice-state";
import type { InvoiceHistoryFilter, ReimbursementCaseStatus, ReimbursementPersonScope, WorkflowStatusFilter } from "../invoice-state";
import type { HubState } from "../state";
import type { MatchAssignment, ReconciliationCase, ReimbursementItem, ReimbursementWorkflowStatus, UnmatchedReimbursement } from "../types";
import { fetchInvoices, setMatchDecision, setReimbursementWorkflowStatus } from "../worker";

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
  const [filters, setFilters] = useState<Set<InvoiceHistoryFilter>>(() => new Set());
  const [personScope, setPersonScope] = useState<ReimbursementPersonScope>("all");
  const [workflowFilter, setWorkflowFilter] = useState<WorkflowStatusFilter>("open");
  const [reconciliationFilter, setReconciliationFilter] = useState<"all" | "matched" | "unmatched">("all");
  const paired = Boolean(hub.worker.Endpoint.trim() && hub.worker.ApiKey.trim());

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

  useEffect(() => { if (paired) void refresh(); }, [paired, hub.worker.Endpoint, hub.worker.ApiKey]);

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
    const cases = buildInvoiceHistoryCases([...(hub.reimbursements.Reconciliations ?? []), ...ignoredCases], hub.reimbursements.Items);
    const unmatched = (hub.reimbursements.UnmatchedReimbursements ?? [])
      .map(result => ({ result, item: byId.get(result.DocumentId) }))
      .filter((entry): entry is { result: UnmatchedReimbursement; item: ReimbursementItem } => Boolean(entry.item))
      .sort((a, b) => dateValue(b.item.ServiceDate || b.item.StatementDate || b.item.ReceivedAt)
        - dateValue(a.item.ServiceDate || a.item.StatementDate || a.item.ReceivedAt));
    const warnings = [...new Set(hub.reimbursements.Items.filter(item => item.Status !== 4).map(item => item.ImportWarning).filter(Boolean))];
    return { cases, unmatched, warnings };
  }, [hub.reimbursements.Items, hub.reimbursements.Reconciliations, hub.reimbursements.IgnoredExpenses, hub.reimbursements.UnmatchedReimbursements]);

  const reviews = new Map((hub.reimbursements.AgentReviews ?? []).map(review => [review.key, review]));
  const invoiceById = new Map(hub.reimbursements.Items.map(item => [item.Id, item]));
  const scopedCases = useMemo(() => filterReimbursementWorkflowCases(model.cases, personScope, "all"), [model.cases, personScope]);
  const scopedUnmatched = useMemo(() => model.unmatched.filter(({ item }) => personScope === "all" || item.Member === personScope), [model.unmatched, personScope]);

  const scopeSummaries = useMemo(() => {
    const scopes: ReimbursementPersonScope[] = ["all", "Kevin", "Jasmine", "Nathan"];
    return new Map(scopes.map(scope => [scope, reimbursementWorkflowSummary(model.cases, scope)]));
  }, [model.cases]);

  const workflowCounts = useMemo(() => ({
    open: scopedCases.filter(item => reimbursementWorkflowStatus(item) === "open").length,
    closed: scopedCases.filter(item => reimbursementWorkflowStatus(item) === "closed").length,
    ignore: scopedCases.filter(item => reimbursementWorkflowStatus(item) === "ignore").length
  }), [scopedCases]);

  const finance = useMemo(() => {
    const cad = scopedCases.filter(item => !item.PreviouslyFound && reimbursementWorkflowStatus(item) !== "ignore" && (item.Currency || "CAD") === "CAD");
    return {
      totalPaid: cad.reduce((sum, item) => sum + (item.OriginalAmount ?? 0), 0),
      primary: cad.reduce((sum, item) => sum + (primaryReimbursementAmount(item) ?? 0), 0),
      secondary: cad.reduce((sum, item) => sum + (secondaryReimbursementAmount(item) ?? 0), 0),
      outstanding: cad.reduce((sum, item) => sum + (item.PotentialRemaining ?? 0), 0),
      attention: scopedCases.filter(item => reimbursementWorkflowStatus(item) === "open" && reimbursementCaseStatus(item) === "needs-attention").length + scopedUnmatched.length
    };
  }, [scopedCases, scopedUnmatched]);

  const filterCounts = useMemo(() => ({
    fully: scopedCases.filter(item => reimbursementCaseStatus(item) === "fully-reimbursed").length,
    outstanding: scopedCases.filter(item => reimbursementCaseStatus(item) !== "fully-reimbursed").length,
    primary: scopedCases.filter(item => (primaryReimbursementAmount(item) ?? 0) > 0).length,
    secondary: scopedCases.filter(item => (secondaryReimbursementAmount(item) ?? 0) > 0).length,
    matched: scopedCases.filter(item => (item.MatchAssignments?.length ?? 0) > 0).length,
    unmatched: scopedUnmatched.length
  }), [scopedCases, scopedUnmatched]);

  const workflowScopedCases = useMemo(() => filterReimbursementWorkflowCases(model.cases, personScope, workflowFilter),
    [model.cases, personScope, workflowFilter]);
  const filteredCases = useMemo(() => {
    if (reconciliationFilter === "unmatched") return [];
    const history = filterInvoiceHistoryCases(workflowScopedCases, filters);
    return reconciliationFilter === "matched" ? history.filter(item => (item.MatchAssignments?.length ?? 0) > 0) : history;
  }, [filters, reconciliationFilter, workflowScopedCases]);
  const visibleUnmatched = useMemo(() => workflowFilter !== "closed" && workflowFilter !== "ignore" && reconciliationFilter !== "matched"
    ? scopedUnmatched : [], [reconciliationFilter, scopedUnmatched, workflowFilter]);

  const scopeLabel = personScope === "all" ? "All family" : personScope;

  function selectScope(scope: ReimbursementPersonScope) {
    setPersonScope(scope);
    setWorkflowFilter("open");
    setReconciliationFilter("all");
    setFilters(new Set<InvoiceHistoryFilter>());
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
      <div>
        <span className="eyebrow">Benefits</span>
        <h1>Reimbursements</h1>
        <p>{lastSuccess ? `Updated ${new Date(lastSuccess).toLocaleString()}` : "Saved results are available even when the PC is offline."}</p>
      </div>
      <button className="button secondary compact-button" disabled={!paired || busy} onClick={() => void refresh()}>
        <RefreshCw size={16} className={busy ? "spin" : ""} />{busy ? "Refreshing…" : "Refresh"}
      </button>
    </section>

    {error && <div className="banner error" role="status"><AlertTriangle size={17} />{error} — Previously synced results remain below.</div>}
    {savedMessage && <div className="banner" role="status">{savedMessage}</div>}
    <p className="privacy-note">{hub.reimbursements.InvoiceCoverage?.complete
      ? "Potential invoice search completed since June 1, 2025 for connected accounts. Scanned images and unreadable attachments may still need review."
      : "Historical collection since June 1, 2025 is not yet confirmed complete. Run the PC collection to resume it."} Insurance coverage is not confirmed by a receipt.</p>
    {model.warnings.map(warning => <div className="banner" role="status" key={warning}><AlertTriangle size={17} />{warning}</div>)}

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

    <section className="reimbursement-summary" aria-label={`${scopeLabel} reimbursement summary`}>
      <article className="summary-primary"><small>Total expenses</small><strong>{money(finance.totalPaid)}</strong><span>{scopeLabel}</span></article>
      <article><small>Primary insurance</small><strong>{money(finance.primary)}</strong><span>reimbursed</span></article>
      <article><small>Secondary insurance</small><strong>{money(finance.secondary)}</strong><span>reimbursed</span></article>
      <article><small>Remaining balance</small><strong>{money(finance.outstanding)}</strong><span>all active statuses</span></article>
      <article className={finance.attention ? "summary-attention" : ""}><small>Needs attention</small><strong>{finance.attention}</strong><span>items</span></article>
    </section>

    <section className="reimbursement-filter-bar" aria-label="Filter reimbursement history">
      <div className="reimbursement-filter-heading">
        <div>
          <strong>{scopeLabel}</strong>
          <span>Newest first · Open is the default work queue</span>
        </div>
        {(filters.size > 0 || workflowFilter !== "open" || reconciliationFilter !== "all") &&
          <button type="button" className="filter-clear" onClick={() => {
            setFilters(new Set<InvoiceHistoryFilter>()); setWorkflowFilter("open"); setReconciliationFilter("all");
          }}>Reset filters</button>}
      </div>
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
        <small>Reconciliation</small>
        <div className="reimbursement-filter-chips">
          <button type="button" className={`filter-chip ${reconciliationFilter === "all" ? "active" : ""}`} onClick={() => setReconciliationFilter("all")}>All</button>
          <button type="button" className={`filter-chip ${reconciliationFilter === "matched" ? "active" : ""}`} onClick={() => setReconciliationFilter("matched")}>Matched <span>{filterCounts.matched}</span></button>
          <button type="button" className={`filter-chip ${reconciliationFilter === "unmatched" ? "active" : ""}`} onClick={() => setReconciliationFilter("unmatched")}>Unmatched <span>{filterCounts.unmatched}</span></button>
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
    </section>

    <section className="reimbursement-history" aria-labelledby="reimbursement-history-title">
      <div className="reimbursement-history-heading">
        <h2 id="reimbursement-history-title">All invoices</h2>
        <span>{filteredCases.length}{filteredCases.length !== model.cases.length ? ` of ${model.cases.length}` : ""}</span>
      </div>

      {!model.cases.length && <div className="empty-state reimbursement-empty"><CircleDollarSign size={30} /><strong>No healthcare expenses yet</strong><span>Run the PC collection after importing invoices and insurer statements.</span></div>}
      {!!model.cases.length && !filteredCases.length && <div className="empty-state reimbursement-empty"><strong>No invoices match these filters</strong><span>Clear one or more filters to restore the full history.</span></div>}

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
          return <article className="expense-card" key={item.Id}>
            <div className="expense-heading">
              <div><strong>{healthcareTitle(item)}</strong><small>{item.Member === "unknown" ? "Person to confirm" : item.Member}{item.ServiceType && healthcareTitle(item) !== item.ServiceType ? ` · ${item.ServiceType}` : ""}{item.ServiceDate ? ` · ${dateLabel(item.ServiceDate)}` : invoiceById.get(item.DocumentIds[0])?.ReceivedAt ? ` · Received ${dateLabel(invoiceById.get(item.DocumentIds[0])!.ReceivedAt)}` : " · Date missing"}</small></div>
              <span className={`reimbursement-status ${item.PreviouslyFound ? "needs-attention" : status}`}>{item.PreviouslyFound ? "Verify source" : <>{status === "fully-reimbursed" && <CheckCircle2 size={14} />}{statusCopy[status]}</>}</span>
            </div>
            <div className="expense-amounts">
              <div><small>Expense</small><strong>{money(item.OriginalAmount, item.Currency)}</strong></div>
              <div><small>{item.PrimaryInsurer || "Primary"}</small><strong>{money(primaryReimbursementAmount(item), item.Currency)}</strong></div>
              <div><small>{item.SecondaryInsurer || "Secondary"}</small><strong>{money(secondaryReimbursementAmount(item), item.Currency)}</strong></div>
              <div className="remaining"><small>Remaining</small><strong>{money(item.PotentialRemaining, item.Currency)}</strong></div>
            </div>
            {matchAssignments.length > 0 && <div className="match-summary">
              <button type="button" className={`match-confidence-button ${reviewRecommended ? "review" : manuallyConfirmed ? "confirmed" : ""}`}
                aria-expanded={matchExpanded} onClick={() => setExpandedMatchId(matchExpanded ? "" : item.Id)}>
                <CheckCircle2 size={15} />
                <span>Matched · {matchConfidence}%</span>
                {manuallyConfirmed && <small>Confirmed manually</small>}
                {!manuallyConfirmed && reviewRecommended && <small>Review</small>}
              </button>
              {matchExpanded && <div className="match-details">
                <div className="match-details-heading"><strong>Why FamilyHub matched this</strong><span>Match confidence is separate from document extraction confidence.</span></div>
                {matchAssignments.map(match => {
                  const reimbursement = invoiceById.get(match.ReimbursementDocumentId);
                  const isSaving = savingId === `match:${match.ReimbursementDocumentId}`;
                  return <div className="match-detail-row" key={match.ReimbursementDocumentId}>
                    <div className="match-detail-main">
                      <div><strong>{match.Insurer === "desjardins" ? "Desjardins" : match.Insurer === "blue-cross" ? "Blue Cross" : reimbursement?.Provider || "Insurer record"}</strong>
                        <span>{Math.round(match.Confidence)}% match{match.Verification === "confirmed-manually" ? " · Confirmed manually" : match.Verification === "review-recommended" ? " · Review recommended" : " · Auto-matched"}</span></div>
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
            {!!item.UnallocatedReimbursedAmount && <p className="privacy-note expense-warning">Known payments: {money(item.UnallocatedReimbursedAmount, item.Currency)} · insurer order to confirm</p>}
            {item.PreviouslyFound && <p className="privacy-note expense-warning">{item.Unreconciled
              ? "Indexed invoice without a reconciliation case. Check the source before relying on its amounts or reimbursement status."
              : "Previously found invoice; the latest PC result did not include it. Check the source before relying on its amounts or reimbursement status."}</p>}
            <div className="expense-note"><span>{item.Summary}</span><small>{matchAssignments.length ? `${matchAssignments.length} matched insurer record${matchAssignments.length === 1 ? "" : "s"}` : `Source confidence ${Math.round(item.Confidence)}%`}</small></div>
            {item.Status === "needs-attention" && item.DocumentIds[0] && reviews.get(`case:${item.DocumentIds[0]}`) &&
              <p className="privacy-note expense-warning">Second AI review: {reviews.get(`case:${item.DocumentIds[0]}`)!.explanation} · Suggestion only; check the source documents.</p>}
            <div className="expense-actions">
              <button type="button" className="mini-button" disabled={!paired || !!savingId || busy} onClick={() => void ignoreExpense(item, true)}>
                {savingId === item.Id ? "Saving…" : "Ignore this expense"}
              </button>
              <small className="privacy-note">Saved on the PC · reversible · future invoices stay eligible for review</small>
            </div>
          </article>;
        })}
      </div>
    </section>

    {(hub.reimbursements.IgnoredExpenses ?? []).length > 0 && <details className="surface ignored-expenses">
      <summary>Ignored expenses ({hub.reimbursements.IgnoredExpenses!.length})</summary>
      <p className="privacy-note">Excluded from attention and totals. Source documents are kept; no insurer decision is implied.</p>
      {hub.reimbursements.IgnoredExpenses!.map(item => <article className="expense-card" key={item.Id}>
        <div className="expense-heading"><div><strong>{healthcareTitle(item)}</strong><small>{item.ServiceDate ? dateLabel(item.ServiceDate) : "Date to confirm"}</small></div>
          <button type="button" className="mini-button" disabled={!paired || !!savingId || busy} onClick={() => void ignoreExpense(item, false)}>{savingId === item.Id ? "Saving…" : "Restore"}</button>
        </div>
      </article>)}
    </details>}

    {model.unmatched.length > 0 && <section className="surface unmatched-panel has-items" aria-labelledby="unmatched-title">
      <div className="section-heading inline"><div><span className="eyebrow">Needs review</span><h2 id="unmatched-title">Unmatched reimbursements</h2></div><span className="unmatched-count">{model.unmatched.length}</span></div>
      {model.unmatched.map(({ result, item }) => <article className="unmatched-row" key={result.DocumentId}>
        <span className="reimbursement-status unmatched">Unmatched</span>
        <div><strong>{item.Provider || item.Subject || "Insurer record"}</strong><small>{item.Member && item.Member !== "unknown" ? `${item.Member} · ` : ""}{item.Insurer === "blue-cross" ? "Blue Cross" : item.Insurer === "desjardins" ? "Desjardins" : "Insurer unknown"} · {dateLabel(item.ServiceDate || item.ReceivedAt)}{item.StatementDate ? ` · Statement ${dateLabel(item.StatementDate)}` : ""}</small><p>{item.NeedsReview && item.Reasons?.length ? item.Reasons[0] : unmatchedReason(result)}</p>
          {reviews.get(`unmatched:${item.Id}`) && <p className="privacy-note expense-warning">Second AI review: {reviews.get(`unmatched:${item.Id}`)!.explanation}{reviews.get(`unmatched:${item.Id}`)!.candidateId ? ` · Possible invoice: ${invoiceById.get(reviews.get(`unmatched:${item.Id}`)!.candidateId!)?.Provider || "see source"}` : ""}. Suggestion only; no automatic link.</p>}</div>
        <div className="unmatched-amount"><strong>{money(reimbursementAmount(item), item.Currency)}</strong><small>reimbursement</small></div>
        <button className="mini-button" onClick={() => googleBridge.openMessage(item.AccountEmail, item.InternetMessageId, item.SourceMessageId)}><ExternalLink size={14} /> Email</button>
      </article>)}
    </section>}
  </div>;
}
