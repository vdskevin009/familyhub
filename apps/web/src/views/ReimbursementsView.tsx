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

const statusCopy: Record<CaseStatus, string> = {
  "fully-reimbursed": "Fully reimbursed",
  "waiting-primary": "Waiting for primary",
  "waiting-secondary": "Waiting for secondary",
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
    const cases = [...(hub.reimbursements.Reconciliations ?? [])];
    const byId = new Map(hub.reimbursements.Items.map(item => [item.Id, item]));
    const unmatched = (hub.reimbursements.UnmatchedReimbursements ?? [])
      .map(result => ({ result, item: byId.get(result.DocumentId) }))
      .filter((entry): entry is { result: UnmatchedReimbursement; item: ReimbursementItem } => Boolean(entry.item));
    const cad = cases.filter(item => (item.Currency || "CAD") === "CAD");
    const totalPaid = cad.reduce((sum, item) => sum + (item.OriginalAmount ?? 0), 0);
    const primary = cad.reduce((sum, item) => sum + (item.PrimaryReimbursedAmount ?? (item.Action === "submit-secondary" ? item.ReimbursedAmount : 0)), 0);
    const secondary = cad.reduce((sum, item) => sum + (item.SecondaryReimbursedAmount ?? 0), 0);
    const outstanding = cad.reduce((sum, item) => sum + (item.PotentialRemaining ?? 0), 0);
    const attention = cases.filter(item => caseStatus(item) !== "fully-reimbursed").length + unmatched.length;
    return { cases, unmatched, totalPaid, primary, secondary, outstanding, attention };
  }, [hub.reimbursements.Items, hub.reimbursements.Reconciliations, hub.reimbursements.UnmatchedReimbursements]);

  return <div className="view-stack">
    <section className="view-hero compact reimbursement-hero">
      <div>
        <span className="eyebrow">Insurance reconciliation</span>
        <h1>Recover what is still owed.</h1>
        <p>Healthcare expenses are matched only when the imported reimbursement evidence is strong enough. Uncertain matches stay visible for review.</p>
      </div>
      <span className="hero-icon"><CircleDollarSign size={27} /></span>
    </section>

    {error && <div className="banner error" role="status"><AlertTriangle size={17} />{error} — Previously synced results remain below.</div>}

    <section className="reimbursement-summary" aria-label="Reimbursement summary">
      <article className="summary-primary"><small>Total paid</small><strong>{money(model.totalPaid)}</strong><span>healthcare expenses</span></article>
      <article><small>Primary insurance</small><strong>{money(model.primary)}</strong><span>reimbursed</span></article>
      <article><small>Secondary insurance</small><strong>{money(model.secondary)}</strong><span>reimbursed</span></article>
      <article><small>Still to recover</small><strong>{money(model.outstanding)}</strong><span>outstanding · verify</span></article>
      <article className={model.attention ? "summary-attention" : ""}><small>Needs attention</small><strong>{model.attention}</strong><span>items</span></article>
    </section>

    <section className="surface reimbursement-source">
      <div>
        <span className="eyebrow">PC agent source</span>
        <h2>Latest imported results</h2>
        <p>{lastSuccess ? `Last complete scan: ${new Date(lastSuccess).toLocaleString()}` : "Saved results remain available when the PC is offline."}</p>
      </div>
      <button className="button secondary" disabled={!paired || busy} onClick={() => void refresh()}>
        <RefreshCw size={16} className={busy ? "spin" : ""} />{busy ? "Refreshing…" : "Refresh from PC"}
      </button>
      {!paired && <small>Pair the PC in More → Local AI to refresh imported reimbursements.</small>}
    </section>

    <section className="surface reimbursement-ledger" aria-labelledby="reimbursement-ledger-title">
      <div className="section-heading">
        <div><span className="eyebrow">Expense by expense</span><h2 id="reimbursement-ledger-title">Reconciliation</h2><p>Amounts are imported evidence, not confirmation that a claim was submitted.</p></div>
        <span className="learning-count">{model.cases.length} healthcare expense{model.cases.length === 1 ? "" : "s"}</span>
      </div>
      {!model.cases.length && <div className="empty-state"><CircleDollarSign size={30} /><strong>No healthcare expenses yet</strong><span>Run the PC collection after importing invoices and insurer statements.</span></div>}
      <div className="expense-list">
        {model.cases.map(item => {
          const status = caseStatus(item);
          return <article className="expense-card" key={item.Id}>
            <div className="expense-heading">
              <div><strong>{item.Provider || "Provider to confirm"}</strong><small>{item.Member === "unknown" ? "Person to confirm" : item.Member}{item.ServiceDate ? ` · ${dateLabel(item.ServiceDate)}` : " · Service date missing"}</small></div>
              <span className={`reimbursement-status ${status}`}>{status === "fully-reimbursed" && <CheckCircle2 size={14} />}{statusCopy[status]}</span>
            </div>
            <div className="expense-amounts">
              <div><small>Expense</small><strong>{money(item.OriginalAmount, item.Currency)}</strong></div>
              <div><small>{item.PrimaryInsurer || "Primary"}</small><strong>{money(item.PrimaryReimbursedAmount ?? (item.Action === "submit-secondary" ? item.ReimbursedAmount : 0), item.Currency)}</strong></div>
              <div><small>{item.SecondaryInsurer || "Secondary"}</small><strong>{money(item.SecondaryReimbursedAmount ?? 0, item.Currency)}</strong></div>
              <div className="remaining"><small>Remaining</small><strong>{money(item.PotentialRemaining, item.Currency)}</strong></div>
            </div>
            <div className="expense-note"><span>{item.Summary}</span><small>Match confidence {Math.round(item.Confidence)}%</small></div>
          </article>;
        })}
      </div>
    </section>

    <section className={`surface unmatched-panel ${model.unmatched.length ? "has-items" : ""}`} aria-labelledby="unmatched-title">
      <div className="section-heading inline"><div><span className="eyebrow">No guessing</span><h2 id="unmatched-title">Unmatched reimbursements</h2><p>These insurer records were not attached to an expense automatically.</p></div><span className="unmatched-count">{model.unmatched.length}</span></div>
      {!model.unmatched.length && <p className="all-matched"><CheckCircle2 size={17} /> No unmatched reimbursement records.</p>}
      {model.unmatched.map(({ result, item }) => <article className="unmatched-row" key={result.DocumentId}>
        <span className="reimbursement-status unmatched">Unmatched</span>
        <div><strong>{item.Provider || item.Subject || "Insurer record"}</strong><small>{item.Insurer === "blue-cross" ? "Blue Cross" : item.Insurer === "desjardins" ? "Desjardins" : "Insurer unknown"} · {dateLabel(item.ReceivedAt)}</small><p>{unmatchedReason(result)}</p></div>
        <div className="unmatched-amount"><strong>{money(reimbursementAmount(item), item.Currency)}</strong><small>reimbursement</small></div>
        <button className="mini-button" onClick={() => googleBridge.openMessage(item.AccountEmail, item.InternetMessageId, item.SourceMessageId)}><ExternalLink size={14} /> Email</button>
      </article>)}
    </section>
  </div>;
}
