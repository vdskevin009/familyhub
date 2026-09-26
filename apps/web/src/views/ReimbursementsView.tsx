import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleDollarSign, ExternalLink, RefreshCw } from "lucide-react";
import { dateLabel } from "../domain";
import { googleBridge } from "../google";
import { mergeInvoiceItems } from "../invoice-state";
import type { HubState } from "../state";
import type { ReconciliationCase, ReimbursementItem, UnmatchedReimbursement } from "../types";
import { fetchInvoices } from "../worker";

type Props = { hub: HubState };
type CaseStatus = NonNullable<ReconciliationCase["Status"]>;
type HistoryFilter = "fully-reimbursed" | "not-fully-reimbursed" | "primary" | "secondary";

const statusCopy: Record<CaseStatus, string> = {
  "fully-reimbursed": "Fully reimbursed",
  "waiting-primary": "Waiting for primary",
  "waiting-secondary": "Waiting for secondary",
  "patient-balance": "Patient balance",
  "needs-attention": "Needs attention"
};

function caseStatus(item: ReconciliationCase): CaseStatus {
  if (item.Status) return item.Status;
  if (item.Action === "complete") return "fully-reimbursed";
  if (item.Action === "submit-primary") return "waiting-primary";
  if (item.Action === "submit-secondary") return "waiting-secondary";
  return "needs-attention";
}

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

function primaryAmount(item: ReconciliationCase): number {
  return item.PrimaryReimbursedAmount ?? (item.Action === "submit-secondary" ? item.ReimbursedAmount : 0);
}

function secondaryAmount(item: ReconciliationCase): number {
  return item.SecondaryReimbursedAmount ?? 0;
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
  const [filters, setFilters] = useState<Set<HistoryFilter>>(() => new Set());
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
        Reconciliations: snapshot.reconciliations,
        CleanupSuggestions: snapshot.cleanupSuggestions,
        ImportantMail: snapshot.importantMail,
        LearningDecisions: snapshot.learning.decisions,
        UnmatchedReimbursements: snapshot.unmatchedReimbursements
      }));
      setLastSuccess(snapshot.lastSuccess || new Date().toISOString());
      if (snapshot.error) setError(snapshot.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The PC results could not be refreshed.");
    } finally { setBusy(false); }
  }

  useEffect(() => { if (paired) void refresh(); }, [paired, hub.worker.Endpoint, hub.worker.ApiKey]);

  const model = useMemo(() => {
    const cases = [...(hub.reimbursements.Reconciliations ?? [])]
      .sort((a, b) => dateValue(b.ServiceDate) - dateValue(a.ServiceDate));
    const byId = new Map(hub.reimbursements.Items.map(item => [item.Id, item]));
    const unmatched = (hub.reimbursements.UnmatchedReimbursements ?? [])
      .map(result => ({ result, item: byId.get(result.DocumentId) }))
      .filter((entry): entry is { result: UnmatchedReimbursement; item: ReimbursementItem } => Boolean(entry.item))
      .sort((a, b) => dateValue(b.item.ServiceDate || b.item.StatementDate || b.item.ReceivedAt)
        - dateValue(a.item.ServiceDate || a.item.StatementDate || a.item.ReceivedAt));
    const cad = cases.filter(item => (item.Currency || "CAD") === "CAD");
    const totalPaid = cad.reduce((sum, item) => sum + (item.OriginalAmount ?? 0), 0);
    const primary = cad.reduce((sum, item) => sum + primaryAmount(item), 0);
    const secondary = cad.reduce((sum, item) => sum + secondaryAmount(item), 0);
    const outstanding = cad.reduce((sum, item) => sum + (item.PotentialRemaining ?? 0), 0);
    const attention = cases.filter(item => caseStatus(item) !== "fully-reimbursed").length + unmatched.length;
    const warnings = [...new Set(hub.reimbursements.Items.filter(item => item.Status !== 4).map(item => item.ImportWarning).filter(Boolean))];
    return { cases, unmatched, totalPaid, primary, secondary, outstanding, attention, warnings };
  }, [hub.reimbursements.Items, hub.reimbursements.Reconciliations, hub.reimbursements.UnmatchedReimbursements]);

  const filterCounts = useMemo(() => ({
    fully: model.cases.filter(item => caseStatus(item) === "fully-reimbursed").length,
    outstanding: model.cases.filter(item => caseStatus(item) !== "fully-reimbursed").length,
    primary: model.cases.filter(item => primaryAmount(item) > 0).length,
    secondary: model.cases.filter(item => secondaryAmount(item) > 0).length
  }), [model.cases]);

  const filteredCases = useMemo(() => {
    const hasStatusFilter = filters.has("fully-reimbursed") || filters.has("not-fully-reimbursed");
    const hasSourceFilter = filters.has("primary") || filters.has("secondary");

    return model.cases.filter(item => {
      const status = caseStatus(item);
      const statusMatches = !hasStatusFilter
        || (filters.has("fully-reimbursed") && status === "fully-reimbursed")
        || (filters.has("not-fully-reimbursed") && status !== "fully-reimbursed");
      const sourceMatches = !hasSourceFilter
        || (filters.has("primary") && primaryAmount(item) > 0)
        || (filters.has("secondary") && secondaryAmount(item) > 0);
      return statusMatches && sourceMatches;
    });
  }, [filters, model.cases]);

  function toggleFilter(filter: HistoryFilter) {
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
    {model.warnings.map(warning => <div className="banner" role="status" key={warning}><AlertTriangle size={17} />{warning}</div>)}

    <section className="reimbursement-summary" aria-label="Reimbursement summary">
      <article className="summary-primary"><small>Total paid</small><strong>{money(model.totalPaid)}</strong><span>healthcare expenses</span></article>
      <article><small>Primary insurance</small><strong>{money(model.primary)}</strong><span>reimbursed</span></article>
      <article><small>Secondary insurance</small><strong>{money(model.secondary)}</strong><span>reimbursed</span></article>
      <article><small>Still to recover</small><strong>{money(model.outstanding)}</strong><span>outstanding · verify</span></article>
      <article className={model.attention ? "summary-attention" : ""}><small>Needs attention</small><strong>{model.attention}</strong><span>items</span></article>
    </section>

    <section className="reimbursement-filter-bar" aria-label="Filter reimbursement history">
      <div className="reimbursement-filter-heading">
        <div>
          <strong>History</strong>
          <span>Newest first</span>
        </div>
        {filters.size > 0 && <button type="button" className="filter-clear" onClick={() => setFilters(new Set())}>Clear filters</button>}
      </div>
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
          const status = caseStatus(item);
          return <article className="expense-card" key={item.Id}>
            <div className="expense-heading">
              <div><strong>{item.Provider || "Provider to confirm"}</strong><small>{item.Member === "unknown" ? "Person to confirm" : item.Member}{item.ServiceDate ? ` · ${dateLabel(item.ServiceDate)}` : " · Service date missing"}</small></div>
              <span className={`reimbursement-status ${status}`}>{status === "fully-reimbursed" && <CheckCircle2 size={14} />}{statusCopy[status]}</span>
            </div>
            <div className="expense-amounts">
              <div><small>Expense</small><strong>{money(item.OriginalAmount, item.Currency)}</strong></div>
              <div><small>{item.PrimaryInsurer || "Primary"}</small><strong>{money(primaryAmount(item), item.Currency)}</strong></div>
              <div><small>{item.SecondaryInsurer || "Secondary"}</small><strong>{money(secondaryAmount(item), item.Currency)}</strong></div>
              <div className="remaining"><small>Remaining</small><strong>{money(item.PotentialRemaining, item.Currency)}</strong></div>
            </div>
            {!!item.UnallocatedReimbursedAmount && <p className="privacy-note expense-warning">Known payments: {money(item.UnallocatedReimbursedAmount, item.Currency)} · insurer order to confirm</p>}
            <div className="expense-note"><span>{item.Summary}</span><small>Match confidence {Math.round(item.Confidence)}%</small></div>
          </article>;
        })}
      </div>
    </section>

    {model.unmatched.length > 0 && <section className="surface unmatched-panel has-items" aria-labelledby="unmatched-title">
      <div className="section-heading inline"><div><span className="eyebrow">Needs review</span><h2 id="unmatched-title">Unmatched reimbursements</h2></div><span className="unmatched-count">{model.unmatched.length}</span></div>
      {model.unmatched.map(({ result, item }) => <article className="unmatched-row" key={result.DocumentId}>
        <span className="reimbursement-status unmatched">Unmatched</span>
        <div><strong>{item.Provider || item.Subject || "Insurer record"}</strong><small>{item.Member && item.Member !== "unknown" ? `${item.Member} · ` : ""}{item.Insurer === "blue-cross" ? "Blue Cross" : item.Insurer === "desjardins" ? "Desjardins" : "Insurer unknown"} · {dateLabel(item.ServiceDate || item.ReceivedAt)}{item.StatementDate ? ` · Statement ${dateLabel(item.StatementDate)}` : ""}</small><p>{item.NeedsReview && item.Reasons?.length ? item.Reasons[0] : unmatchedReason(result)}</p></div>
        <div className="unmatched-amount"><strong>{money(reimbursementAmount(item), item.Currency)}</strong><small>reimbursement</small></div>
        <button className="mini-button" onClick={() => googleBridge.openMessage(item.AccountEmail, item.InternetMessageId, item.SourceMessageId)}><ExternalLink size={14} /> Email</button>
      </article>)}
    </section>}
  </div>;
}
