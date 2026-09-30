import { Sheet as AppSheet, SearchField, Notice } from "../ui/primitives";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, ExternalLink, Search, X } from "lucide-react";
import { dateLabel } from "../domain";
import { googleBridge } from "../google";
import { healthcareTitle } from "../invoice-state";
import type { ReimbursementPersonScope } from "../invoice-state";
import {
  reconciliationCaseDate,
  reconciliationContextCases,
  reconciliationDateDistanceDays,
  reconciliationTriageAssessment
} from "../reconciliation-triage";
import type { ReconciliationCase, ReimbursementItem, UnmatchedReimbursement } from "../types";

type QueueEntry = { result: UnmatchedReimbursement; item: ReimbursementItem };

type Props = {
  items: ReimbursementItem[];
  cases: ReconciliationCase[];
  unmatched: QueueEntry[];
  ignoredUnmatched: QueueEntry[];
  personScope: ReimbursementPersonScope;
  paired: boolean;
  manualActionsAvailable: boolean;
  busy: boolean;
  savingId: string;
  operationError?: string; operationMessage?: string;
  onPersonScopeChange: (scope: ReimbursementPersonScope) => void;
  onMatch: (expense: ReconciliationCase, reimbursementId: string) => Promise<boolean>;
  onIgnore: (reimbursementId: string, ignored: boolean) => Promise<boolean>;
};

type Sheet = "search" | "context" | null;

function money(value: number | null | undefined, code = "CAD"): string {
  if (value == null || !Number.isFinite(value)) return "—";
  try { return new Intl.NumberFormat("en-CA", { style: "currency", currency: code || "CAD" }).format(value); }
  catch { return `${value.toFixed(2)} ${code || "CAD"}`; }
}

function reimbursementAmount(item: ReimbursementItem): number | null {
  return item.ReimbursedAmount ?? item.DetectedAmount ?? null;
}

function insurerName(item: ReimbursementItem): string {
  if (item.Insurer === "desjardins") return "Desjardins";
  if (item.Insurer === "blue-cross") return "Blue Cross";
  return "Insurer unknown";
}

function serviceName(item: ReimbursementItem): string {
  return item.Healthcare?.ServiceType || item.ClaimedService || item.Provider || "Service not identified";
}

function unmatchedReason(item: UnmatchedReimbursement): string {
  if (item.Reason === "ambiguous-match") return "Multiple expenses remain plausible.";
  if (item.Reason === "missing-insurer") return "The insurer is not identified confidently.";
  if (item.Reason === "needs-review") return "The source still needs classification review.";
  return "No expense was matched confidently.";
}

function searchText(item: ReconciliationCase, source: ReimbursementItem | undefined): string {
  return [
    item.Provider,
    item.ServiceType,
    item.Summary,
    source?.Provider,
    source?.Healthcare?.Provider,
    source?.Healthcare?.ServiceType,
    source?.Healthcare?.InvoiceNumber
  ].filter(Boolean).join(" ").toLowerCase();
}

export default function ReconciliationQueue({
  items,
  cases,
  unmatched,
  ignoredUnmatched,
  personScope,
  paired,
  manualActionsAvailable,
  busy,
  savingId,
  operationError, operationMessage,
  onPersonScopeChange,
  onMatch,
  onIgnore
}: Props) {
  const [index, setIndex] = useState(0);
  const [sessionTotal, setSessionTotal] = useState(unmatched.length);
  const [sessionScope, setSessionScope] = useState(personScope);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [search, setSearch] = useState("");
  const [showAllDates, setShowAllDates] = useState(false);
  const itemsById = useMemo(() => new Map(items.map(item => [item.Id, item])), [items]);

  useEffect(() => {
    if (sessionScope !== personScope) {
      setSessionScope(personScope);
      setSessionTotal(unmatched.length);
      setIndex(0);
      setSheet(null);
      setSearch("");
      setShowAllDates(false);
      return;
    }
    setSessionTotal(previous => Math.max(previous, unmatched.length));
  }, [personScope, sessionScope, unmatched.length]);

  useEffect(() => {
    if (!unmatched.length) setIndex(0);
    else if (index >= unmatched.length) setIndex(unmatched.length - 1);
  }, [index, unmatched.length]);

  const current = unmatched[index] ?? null;
  const assessment = useMemo(() => current
    ? reconciliationTriageAssessment(current.item, cases, itemsById, 5)
    : null, [current, cases, itemsById]);

  const summary = useMemo(() => {
    let strong = 0;
    let ambiguous = 0;
    let none = 0;
    let possible = 0;
    for (const entry of unmatched) {
      const result = reconciliationTriageAssessment(entry.item, cases, itemsById, 5);
      if (result.Kind === "strong") strong++;
      else if (result.Kind === "ambiguous") ambiguous++;
      else if (result.Kind === "none") none++;
      else possible++;
    }
    return { strong, ambiguous, none, possible };
  }, [unmatched, cases, itemsById]);

  const nearbyCases = useMemo(() => current
    ? reconciliationContextCases(current.item, cases, itemsById, 30)
    : [], [current, cases, itemsById]);

  const nearbyUnmatched = useMemo(() => {
    if (!current) return [];
    return unmatched
      .filter(entry => entry.item.Id !== current.item.Id)
      .filter(entry => current.item.Member === "unknown" || entry.item.Member === "unknown" || entry.item.Member === current.item.Member)
      .map(entry => ({
        ...entry,
        distance: reconciliationDateDistanceDays(current.item.ServiceDate, entry.item.ServiceDate)
      }))
      .filter(entry => current.item.ServiceDate == null || entry.distance == null || entry.distance <= 30)
      .sort((a, b) => (a.distance ?? Number.MAX_SAFE_INTEGER) - (b.distance ?? Number.MAX_SAFE_INTEGER))
      .slice(0, 8);
  }, [current, unmatched]);

  const searchCases = useMemo(() => {
    if (!current) return [];
    const member = current.item.Member && current.item.Member !== "unknown" ? current.item.Member : null;
    const needle = search.trim().toLowerCase();
    return cases
      .filter(item => item.WorkflowStatus !== "ignore")
      .filter(item => !member || item.Member === "unknown" || item.Member === member)
      .map(item => {
        const sourceId = item.ExpenseDocumentId || item.ExpenseDocumentIds?.[0] || item.DocumentIds[0];
        const source = sourceId ? itemsById.get(sourceId) : undefined;
        const distance = reconciliationDateDistanceDays(current.item.ServiceDate, reconciliationCaseDate(item, itemsById));
        return { item, source, distance };
      })
      .filter(entry => showAllDates || current.item.ServiceDate == null || entry.distance == null || entry.distance <= 30)
      .filter(entry => !needle || searchText(entry.item, entry.source).includes(needle))
      .sort((a, b) => (a.distance ?? Number.MAX_SAFE_INTEGER) - (b.distance ?? Number.MAX_SAFE_INTEGER)
        || a.item.Id.localeCompare(b.item.Id))
      .slice(0, 40);
  }, [cases, current, itemsById, search, showAllDates]);

  const remaining = unmatched.length;
  const processed = Math.max(0, sessionTotal - remaining);
  const actionDisabled = !paired || !manualActionsAvailable || !!savingId || busy;

  function openSheet(next: Exclude<Sheet, null>) {
    setSheet(next);
    setSearch("");
    setShowAllDates(false);
  }

  if (!current) {
    return <section className="reconcile-workspace">
      <div className="reconcile-scope-row" aria-label="Reconciliation family member">
        {(["all", "Kevin", "Jasmine", "Nathan"] as ReimbursementPersonScope[]).map(scope =>
          <button type="button" key={scope} className={personScope === scope ? "active" : ""}
            aria-pressed={personScope === scope} onClick={() => onPersonScopeChange(scope)}>
            {scope === "all" ? "All family" : scope}
          </button>)}
      </div>
      <div className="reconcile-complete">
        <CheckCircle2 size={34} />
        <strong>No active unmatched reimbursements</strong>
        <span>{personScope === "all" ? "The active reconciliation queue is clear." : `${personScope}'s active reconciliation queue is clear.`}</span>
      </div>
      {ignoredUnmatched.length > 0 && <details className="reconcile-ignored">
        <summary>Ignored unmatched <span>{ignoredUnmatched.length}</span></summary>
        <div>
          {ignoredUnmatched.map(({ result, item }) => <article key={item.Id}>
            <div><strong>{insurerName(item)} · {money(reimbursementAmount(item), item.Currency)}</strong>
              <small>{item.Member || "Unknown member"} · {dateLabel(item.ServiceDate || item.ReceivedAt)}</small>
              <span>{unmatchedReason(result)}</span></div>
            <button type="button" className="mini-button" disabled={actionDisabled}
              onClick={() => void onIgnore(item.Id, false)}>
              {savingId === `unmatched-ignore:${item.Id}` ? "Restoring…" : manualActionsAvailable ? "Restore" : "Update PC worker"}
            </button>
          </article>)}
        </div>
      </details>}
    </section>;
  }

  const queueLabel = assessment?.Kind === "strong"
    ? "Strong candidate"
    : assessment?.Kind === "ambiguous"
      ? "Ambiguous"
      : assessment?.Kind === "none"
        ? "No candidate"
        : "Possible candidate";

  return <section className="reconcile-workspace" aria-labelledby="reconcile-title">
    <div className="reconcile-scope-row" aria-label="Reconciliation family member">
      {(["all", "Kevin", "Jasmine", "Nathan"] as ReimbursementPersonScope[]).map(scope =>
        <button type="button" key={scope} className={personScope === scope ? "active" : ""}
          aria-pressed={personScope === scope} onClick={() => onPersonScopeChange(scope)}>
          {scope === "all" ? "All family" : scope}
        </button>)}
    </div>

    <div className="reconcile-queue-summary">
      <div><small>Remaining</small><strong>{remaining}</strong><span>{sessionTotal ? `${processed} processed this session` : "Queue clear"}</span></div>
      <div><small>Strong</small><strong>{summary.strong}</strong><span>clear lead</span></div>
      <div><small>Ambiguous</small><strong>{summary.ambiguous}</strong><span>needs choice</span></div>
      <div><small>No candidate</small><strong>{summary.none}</strong><span>search manually</span></div>
    </div>

    <div className="reconcile-progress">
      <button type="button" className="icon-button" aria-label="Previous unmatched reimbursement"
        disabled={index <= 0} onClick={() => { setIndex(value => Math.max(0, value - 1)); setSheet(null); }}>
        <ArrowLeft size={18} />
      </button>
      <div>
        <strong id="reconcile-title">À réconcilier</strong>
        <span>Case {index + 1} of {remaining} · {remaining} remaining{sessionTotal > remaining ? ` of ${sessionTotal} started` : ""}</span>
      </div>
      <button type="button" className="icon-button" aria-label="Next unmatched reimbursement"
        disabled={index >= remaining - 1} onClick={() => { setIndex(value => Math.min(remaining - 1, value + 1)); setSheet(null); }}>
        <ArrowRight size={18} />
      </button>
    </div>

    <article className="reconcile-current-card">
      <div className="reconcile-current-heading">
        <div>
          <span className={`reconcile-kind ${assessment?.Kind || "none"}`}>{queueLabel}</span>
          <h2>{current.item.Provider || current.item.Subject || "Insurer reimbursement"}</h2>
          <p>{current.item.Member && current.item.Member !== "unknown" ? current.item.Member : "Person to confirm"} · {insurerName(current.item)}</p>
        </div>
        <div className="reconcile-current-amount">
          <strong>{money(reimbursementAmount(current.item), current.item.Currency)}</strong>
          <small>reimbursed</small>
        </div>
      </div>

      <div className="reconcile-facts">
        <div><small>Service date</small><strong>{current.item.ServiceDate ? dateLabel(current.item.ServiceDate) : "Unknown"}</strong></div>
        <div><small>Statement</small><strong>{current.item.StatementDate ? dateLabel(current.item.StatementDate) : "—"}</strong></div>
        <div><small>Service</small><strong>{serviceName(current.item)}</strong></div>
        <div><small>Submitted</small><strong>{money(current.item.BilledAmount, current.item.Currency)}</strong></div>
      </div>

      <p className="reconcile-reason">{current.item.NeedsReview && current.item.Reasons?.length ? current.item.Reasons[0] : unmatchedReason(current.result)}</p>
      {!!current.item.Reasons?.length && <div className="reconcile-source-evidence">
        {current.item.Reasons.slice(0, 3).map((reason, reasonIndex) => <span key={reasonIndex}>{reason}</span>)}
      </div>}

      <div className="reconcile-source-actions">
        <button type="button" className="mini-button subtle" onClick={() => googleBridge.openMessage(current.item.AccountEmail, current.item.InternetMessageId, current.item.SourceMessageId)}>
          <ExternalLink size={14} /> Source email
        </button>
        <button type="button" className="mini-button subtle" onClick={() => openSheet("context")}>View in context</button>
        <button type="button" className="mini-button subtle" onClick={() => openSheet("search")}><Search size={14} /> Search another invoice</button>
        <button type="button" className="mini-button subtle danger-text" disabled={actionDisabled}
          onClick={() => void onIgnore(current.item.Id, true)}>
          {savingId === `unmatched-ignore:${current.item.Id}` ? "Saving…" : manualActionsAvailable ? "Ignore" : "Update PC worker"}
        </button>
      </div>
    </article>

    <section className="reconcile-candidates" aria-label="Suggested expense matches">
      <div className="reconcile-section-heading">
        <div><strong>Best expense candidates</strong><span>FamilyHub ranks existing evidence only. You make the match.</span></div>
        <span>{assessment?.Candidates.length ?? 0}</span>
      </div>

      {!assessment?.Candidates.length && <div className="reconcile-no-candidate">
        <AlertTriangle size={20} />
        <div><strong>No safe candidate surfaced</strong><span>Use Search another invoice to broaden the view without creating an automatic match.</span></div>
      </div>}

      {assessment?.Candidates.map((candidate, candidateIndex) => <article className={`reconcile-candidate-card ${candidateIndex === 0 && assessment.Kind === "strong" ? "top" : ""}`}
        key={candidate.Case.Id}>
        <div className="reconcile-candidate-heading">
          <div>
            <span>{candidateIndex === 0 && assessment.Kind === "strong" ? "Best candidate" : `Candidate ${candidateIndex + 1}`}</span>
            <strong>{healthcareTitle(candidate.Case)}</strong>
            <small>{candidate.Case.Member === "unknown" ? "Person to confirm" : candidate.Case.Member} · {candidate.Case.ServiceDate ? dateLabel(candidate.Case.ServiceDate) : "Date missing"}{candidate.Case.ServiceType ? ` · ${candidate.Case.ServiceType}` : ""}</small>
          </div>
          <div><strong>{money(candidate.Case.OriginalAmount, candidate.Case.Currency)}</strong><small>expense</small></div>
        </div>
        <div className="reconcile-candidate-reasons">
          {candidate.Reasons.map(reason => <span key={reason}>✓ {reason}</span>)}
        </div>
        <div className="reconcile-candidate-footer">
          <div><small>Remaining</small><strong>{money(candidate.Case.PotentialRemaining, candidate.Case.Currency)}</strong></div>
          <button type="button" className="mini-button primary" disabled={actionDisabled}
            onClick={() => void onMatch(candidate.Case, current.item.Id)}>
            {savingId === `manual-match:${current.item.Id}` ? "Matching…" : manualActionsAvailable ? "Match to this expense" : "Update PC worker"}
          </button>
        </div>
      </article>)}
    </section>

    {ignoredUnmatched.length > 0 && <details className="reconcile-ignored">
      <summary>Ignored unmatched <span>{ignoredUnmatched.length}</span></summary>
      <div>
        {ignoredUnmatched.map(({ result, item }) => <article key={item.Id}>
          <div><strong>{insurerName(item)} · {money(reimbursementAmount(item), item.Currency)}</strong>
            <small>{item.Member || "Unknown member"} · {dateLabel(item.ServiceDate || item.ReceivedAt)}</small>
            <span>{unmatchedReason(result)}</span></div>
          <button type="button" className="mini-button" disabled={actionDisabled}
            onClick={() => void onIgnore(item.Id, false)}>
            {savingId === `unmatched-ignore:${item.Id}` ? "Restoring…" : manualActionsAvailable ? "Restore" : "Update PC worker"}
          </button>
        </article>)}
      </div>
    </details>}

    <AppSheet open={sheet !== null} onClose={() => setSheet(null)} title={sheet === "search" ? "Search another invoice" : "Around this reimbursement"}
      description={`${current.item.Member || "Unknown member"} · ${current.item.ServiceDate ? dateLabel(current.item.ServiceDate) : "Date unknown"}`} wide>
        {operationError && <Notice error>{operationError}</Notice>}
        {operationMessage && <Notice>{operationMessage}</Notice>}
        {sheet === "search" && <>
          <div className="reconcile-prefill">
            <span>Member: {current.item.Member || "unknown"}</span>
            <span>Date: {current.item.ServiceDate ? `±30 days from ${dateLabel(current.item.ServiceDate)}` : "unknown"}</span>
            <span>Provider: {current.item.Healthcare?.Provider || current.item.Provider || "unknown"}</span>
            <span>Service: {current.item.Healthcare?.ServiceType || current.item.ClaimedService || "unknown"}</span>
            <span>Amount: {money(current.item.BilledAmount ?? reimbursementAmount(current.item), current.item.Currency)}</span>
          </div>
          <div className="reconcile-search-controls">
            <SearchField value={search} onChange={setSearch} label="Search another invoice" placeholder="Provider, service or reference" />
            <button type="button" className="mini-button subtle" onClick={() => setShowAllDates(value => !value)}>
              {showAllDates ? "Use ±30 days" : "Show all dates"}
            </button>
          </div>
          <div className="reconcile-search-results">
            {!searchCases.length && <div className="reconcile-no-candidate"><AlertTriangle size={20} /><div><strong>No invoice in this view</strong><span>Try showing all dates or changing the search text.</span></div></div>}
            {searchCases.map(({ item, distance }) => <article key={item.Id}>
              <div><strong>{healthcareTitle(item)}</strong>
                <small>{item.ServiceDate ? dateLabel(item.ServiceDate) : "Date missing"}{distance != null ? ` · ${distance} day${distance === 1 ? "" : "s"} away` : ""}{item.ServiceType ? ` · ${item.ServiceType}` : ""}</small>
                <span>{item.Summary}</span></div>
              <div className="reconcile-search-result-action"><strong>{money(item.OriginalAmount, item.Currency)}</strong>
                <button type="button" className="mini-button primary" disabled={actionDisabled}
                  onClick={() => { void onMatch(item, current.item.Id).then(saved => { if (saved) setSheet(null); }); }}>
                  {savingId === `manual-match:${current.item.Id}` ? "Matching…" : "Match"}
                </button></div>
            </article>)}
          </div>
        </>}

        {sheet === "context" && <div className="reconcile-context">
          <p>Expenses and insurer evidence within 30 days of this service date. This view does not create a match.</p>
          <div className="reconcile-context-list">
            {nearbyCases.map(item => {
              const assignments = item.MatchAssignments ?? [];
              return <article key={item.Id}>
                <div className="reconcile-context-expense">
                  <div><strong>{healthcareTitle(item)}</strong><small>{item.ServiceDate ? dateLabel(item.ServiceDate) : "Date missing"}{item.ServiceType ? ` · ${item.ServiceType}` : ""}</small></div>
                  <strong>{money(item.OriginalAmount, item.Currency)}</strong>
                </div>
                {assignments.length > 0
                  ? <div className="reconcile-context-assignments">{assignments.map(match => {
                    const source = itemsById.get(match.ReimbursementDocumentId);
                    return <span key={match.ReimbursementDocumentId}>{match.Insurer === "desjardins" ? "Desjardins" : match.Insurer === "blue-cross" ? "Blue Cross" : "Insurer"} · {money(reimbursementAmount(source ?? {} as ReimbursementItem), source?.Currency || item.Currency)} · {match.Verification === "confirmed-manually" ? "confirmed" : "matched"}</span>;
                  })}</div>
                  : <small className="reconcile-context-empty">No insurer reimbursement assigned</small>}
              </article>;
            })}
            {!nearbyCases.length && <div className="reconcile-no-candidate"><AlertTriangle size={20} /><div><strong>No nearby expense cases</strong><span>Use Search another invoice for a wider search.</span></div></div>}
          </div>
          {nearbyUnmatched.length > 0 && <div className="reconcile-context-unmatched">
            <strong>Other unmatched reimbursements nearby</strong>
            {nearbyUnmatched.map(entry => <span key={entry.item.Id}>{insurerName(entry.item)} · {dateLabel(entry.item.ServiceDate || entry.item.ReceivedAt)} · {money(reimbursementAmount(entry.item), entry.item.Currency)}</span>)}
          </div>}
        </div>}
    </AppSheet>
  </section>;
}
