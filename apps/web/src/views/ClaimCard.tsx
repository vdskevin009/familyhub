import { useState } from "react";
import { CheckCircle2, ChevronRight, ExternalLink, Link2, LoaderCircle } from "lucide-react";
import { dateLabel } from "../domain";
import { healthcareTitle, namedInsurerReimbursementAmount, reimbursementActionLabel, reimbursementCaseStatus, reimbursementEvidenceSources, reimbursementInvoicePdfOptions, reimbursementWorkflowStatus } from "../invoice-state";
import type { ReimbursementInvoicePdfOption } from "../invoice-state";
import type { MatchAssignment, ReconciliationCase, ReimbursementItem, ReimbursementWorkflowStatus, UnmatchedReimbursement } from "../types";
import { manualMatchExpenseId } from "../reconciliation-triage";
import type { MutationProgress } from "../ui/mutation-queue";
import { Notice, Sheet } from "../ui/primitives";
import NearbySources from "./NearbySources";
import type { DocumentLibraryKind } from "../document-library";

export function money(value: number | null | undefined, code = "CAD"): string {
  if (value == null || !Number.isFinite(value)) return "—";
  try { return new Intl.NumberFormat("en-CA", { style: "currency", currency: code || "CAD" }).format(value); }
  catch { return `${value.toFixed(2)} ${code || "CAD"}`; }
}
function reimbursementAmount(item: ReimbursementItem) { return item.ReimbursedAmount ?? item.DetectedAmount ?? null; }
function unmatchedReason(item: UnmatchedReimbursement): string {
  if (item.Reason === "ambiguous-match") return "Several expenses could match. Review before linking.";
  if (item.Reason === "missing-insurer") return "Insurer to confirm.";
  if (item.Reason === "needs-review") return "Source classification needs review.";
  return "No confirmed expense link.";
}
const statusCopy = { "fully-reimbursed": "Fully reimbursed", "waiting-primary": "Waiting for primary", "waiting-secondary": "Waiting for secondary", "patient-balance": "Patient balance", "needs-attention": "Needs attention" };

type Props = {
  item: ReconciliationCase; invoiceById: Map<string, ReimbursementItem>;
  unmatched: { result: UnmatchedReimbursement; item: ReimbursementItem }[];
  paired: boolean; manualActionsAvailable: boolean; busy: boolean; savingId: string;
  selecting: boolean; selected: boolean; toggleSelected: () => void;
  pending?: MutationProgress; reviewExplanation?: string; operationError?: string; operationMessage?: string;
  changeWorkflow: (item: ReconciliationCase, status: ReimbursementWorkflowStatus | "automatic") => Promise<void>;
  decideMatch: (assignment: MatchAssignment, decision: "confirmed" | "rejected") => Promise<void>;
  matchUnmatched: (item: ReconciliationCase, reimbursementId: string, confirmedServiceDate?: string) => Promise<boolean>;
  changeUnmatchedIgnored: (reimbursementId: string, ignored: boolean) => Promise<boolean>;
  openInvoicePdf: (option: ReimbursementInvoicePdfOption) => Promise<void>;
  prepareClaim?: (expenseId: string) => void;
  allCases?: ReconciliationCase[];
  ignoredSourceIds?: ReadonlySet<string>;
  unmatchedSourceIds?: ReadonlySet<string>;
};

export default function ClaimCard({ item, invoiceById, unmatched, paired, manualActionsAvailable, busy, savingId,
  selecting, selected, toggleSelected, pending, reviewExplanation, operationError, operationMessage, changeWorkflow, decideMatch, matchUnmatched, changeUnmatchedIgnored, openInvoicePdf, prepareClaim, allCases = [], ignoredSourceIds = new Set<string>(), unmatchedSourceIds = new Set<string>() }: Props) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [reviewSource, setReviewSource] = useState<DocumentLibraryKind | null>(null);
  const status = reimbursementCaseStatus(item);
  const workflow = reimbursementWorkflowStatus(item);
  const workflowValue = item.WorkflowOrigin === "manual" ? workflow : "automatic";
  const title = healthcareTitle(item);
  const matchAssignments = item.MatchAssignments ?? [];
  const matchConfidence = matchAssignments.length ? Math.round(item.MatchConfidence ?? Math.min(...matchAssignments.map(match => match.Confidence))) : null;
  const manuallyConfirmed = matchAssignments.length > 0 && matchAssignments.every(match => match.Verification === "confirmed-manually");
  const reviewRecommended = matchAssignments.some(match => match.Verification === "review-recommended");
  const evidenceSources = reimbursementEvidenceSources(item, invoiceById);
  const defaultSource: DocumentLibraryKind = item.OriginalInvoiceMissing ? "invoices" : !evidenceSources.includes("Desjardins") ? "desjardins" : !evidenceSources.includes("Blue Cross") ? "blue-cross" : "invoices";
  function reviewNearby(source: DocumentLibraryKind) { setReviewSource(source); setDetailsOpen(true); }
  const sameDayUnmatched = manualMatchExpenseId(item) && item.ServiceDate ? unmatched.filter(({ item: candidate }) =>
    candidate.Member === item.Member && candidate.ServiceDate?.slice(0, 10) === item.ServiceDate?.slice(0, 10)) : [];
  const invoicePdfOptions = reimbursementInvoicePdfOptions(item, invoiceById);
  const received = invoiceById.get(item.DocumentIds[0])?.ReceivedAt;
  const selectable = workflow !== "ignore" && Boolean(item.ExpenseDocumentId || item.ExpenseDocumentIds?.[0] || item.DocumentIds[0]);
  const actionLabel = reimbursementActionLabel(item);
  const pendingValue = pending?.label.toLowerCase();
  const pendingText = pending ? `${pending.label} · ${pending.phase === "queued" ? "Queued" : pending.phase === "saving" ? "Saving…" : pending.phase === "checking" ? "Checking result…" : "Saved, updating…"}` : "";
  const invoice = invoicePdfOptions[0];
  return <article className={`expense-card ${selected ? "bulk-selected" : ""}`} data-workflow={workflow} data-claim-id={item.Id}>
    <div className="claim-top">
      {selecting && selectable && <label className="claim-select-control"><input type="checkbox" checked={selected} onChange={toggleSelected} aria-label={`Select claim: ${title}`} /></label>}
      <div className="claim-title"><h3>{title}</h3><p>{item.Member === "unknown" ? "Person to confirm" : item.Member}<span aria-hidden="true"> · </span>{item.ServiceDate ? dateLabel(item.ServiceDate) : received ? `Received ${dateLabel(received)}` : "Date missing"}</p></div>
      <div className={`claim-status-control ${workflow}`}>
        <label className="sr-only" htmlFor={`workflow-${item.Id}`}>Status for {title}</label>
        <select id={`workflow-${item.Id}`} aria-label={`Status for ${title}`} value={pendingValue || workflowValue}
          disabled={!paired || Boolean(pending) || busy} onChange={event => void changeWorkflow(item, event.target.value as ReimbursementWorkflowStatus | "automatic")}>
          <option value="automatic">{item.AutomaticWorkflowStatus === "closed" ? "Closed" : "Open"} · Auto</option>
          {!item.InferredFromInsurer && <option value="open">Open</option>}
          {!item.InferredFromInsurer && <option value="closed">Closed</option>}
          <option value="ignore">Ignored</option>
        </select>
      </div>
    </div>
    {pending && <div className="claim-pending" role="status"><LoaderCircle size={14} className="spin" />{pendingText}</div>}
    {item.ServiceType && title !== item.ServiceType && <span className="claim-service">{item.ServiceType}</span>}
    <div className="expense-amounts">
      <div><small>Expense</small><strong>{money(item.OriginalAmount, item.Currency)}</strong></div>
      <div><small>Desjardins</small><strong>{money(namedInsurerReimbursementAmount(item, "Desjardins", invoiceById), item.Currency)}</strong></div>
      <div><small>Blue Cross</small><strong>{money(namedInsurerReimbursementAmount(item, "Blue Cross", invoiceById), item.Currency)}</strong></div>
      <div className="remaining"><small>Remaining</small><strong>{money(item.PotentialRemaining, item.Currency)}</strong></div>
    </div>
    <div className={`claim-next-action ${item.PreviouslyFound || status === "needs-attention" ? "warning" : workflow}`}>
      {status === "fully-reimbursed" && <CheckCircle2 size={14} />}
      <span>{item.PreviouslyFound ? "Verify saved source" : actionLabel}</span>
    </div>
    {workflow === "open" && (item.PreviouslyFound || item.HasUnresolvedReimbursementEvidence || (item.Currency || "CAD") !== "CAD") &&
      <small>Excluded from the CAD recovery total: {item.PreviouslyFound ? "saved source needs verification" : item.HasUnresolvedReimbursementEvidence ? "payment links need review" : "different currency"}.</small>}
    <div className="claim-evidence" aria-label="Evidence sources">
      {evidenceSources.map(source => <button type="button" className="source-badge" key={source} onClick={() => reviewNearby(source === "Email" ? "invoices" : source === "Desjardins" ? "desjardins" : "blue-cross")} aria-label={`Review nearby ${source === "Email" ? "invoice" : source} records`}>{source}</button>)}
      {item.OriginalInvoiceMissing && <button type="button" className="evidence-note" onClick={() => reviewNearby("invoices")}>Invoice missing</button>}
      {!evidenceSources.includes("Desjardins") && <button type="button" className="evidence-note" onClick={() => reviewNearby("desjardins")}>DJ missing</button>}
      {!evidenceSources.includes("Blue Cross") && <button type="button" className="evidence-note" onClick={() => reviewNearby("blue-cross")}>BC missing</button>}
      {matchAssignments.length > 0 && <button type="button" className={`confidence-link ${reviewRecommended ? "warning" : ""}`} onClick={() => setDetailsOpen(true)} aria-label={`Review insurer links, ${matchConfidence}% confidence`}><Link2 size={13} />{matchConfidence}%{manuallyConfirmed ? " · Confirmed" : reviewRecommended ? " · Review" : ""}</button>}
    </div>
    {sameDayUnmatched.length > 0 && <button type="button" className="candidate-shortcut" onClick={() => setDetailsOpen(true)}><Link2 size={15} /><span>{sameDayUnmatched.length} same-day reimbursement{sameDayUnmatched.length > 1 ? "s" : ""} to review</span><ChevronRight size={16} /></button>}
    <footer className="claim-footer">
      {!item.InferredFromInsurer && workflow === "open" && prepareClaim && <button type="button" className="text-action" disabled={!paired || busy || !!pending} onClick={() => prepareClaim(item.ExpenseDocumentId || item.ExpenseDocumentIds?.[0] || item.DocumentIds[0])}>Prepare claim</button>}
      {invoice && invoicePdfOptions.length === 1 ? invoice.Source === "drive" && invoice.Url
        ? <a className="text-action" href={invoice.Url} target="_blank" rel="noreferrer"><ExternalLink size={15} />Invoice</a>
        : <button type="button" className="text-action" disabled={!paired || !!savingId} onClick={() => void openInvoicePdf(invoice)}><ExternalLink size={15} />{savingId === `pdf:${invoice.ItemId}:${invoice.AttachmentIndex}` ? "Opening…" : "Invoice"}</button>
        : <span className="claim-detail-label">{item.PreviouslyFound ? "Saved source · verify" : statusCopy[status]}</span>}
      <button type="button" className="text-action" onClick={() => setDetailsOpen(true)} aria-haspopup="dialog">Details<ChevronRight size={16} /></button>
    </footer>
    <Sheet open={detailsOpen} onClose={() => setDetailsOpen(false)} title={title} description={`${item.Member} · ${item.ServiceDate ? dateLabel(item.ServiceDate) : "Date to confirm"}`}>
      <div className="claim-detail-stack">
        {operationError && <Notice error>{operationError}</Notice>}
        {operationMessage && <Notice>{operationMessage}</Notice>}
        <div className="detail-workflow"><span className={`workflow-status ${workflow}`}>{workflow}</span><span>{item.WorkflowOrigin === "manual" ? "Manual choice" : "Automatic workflow"}{item.WorkflowChangedAt ? ` · ${new Date(item.WorkflowChangedAt).toLocaleString()}` : ""}</span></div>
        <div className="expense-amounts"><div><small>Expense</small><strong>{money(item.OriginalAmount, item.Currency)}</strong></div><div><small>Desjardins</small><strong>{money(namedInsurerReimbursementAmount(item, "Desjardins", invoiceById), item.Currency)}</strong></div><div><small>Blue Cross</small><strong>{money(namedInsurerReimbursementAmount(item, "Blue Cross", invoiceById), item.Currency)}</strong></div><div className="remaining"><small>Remaining</small><strong>{money(item.PotentialRemaining, item.Currency)}</strong></div></div>
        {item.OriginalInvoiceMissing && <p className="privacy-note">The original invoice has not been found. These amounts come from insurer evidence, not an inferred receipt.</p>}
        <NearbySources claim={item} kind={reviewSource || defaultSource} onKindChange={setReviewSource}
          items={[...invoiceById.values()]} cases={allCases} ignoredIds={ignoredSourceIds}
          unmatchedIds={unmatchedSourceIds} onLink={matchUnmatched} manualActionsAvailable={manualActionsAvailable && !busy}
          paired={paired} savingId={savingId} openPdf={openInvoicePdf} />
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
              {<div className="match-details">
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
            {item.Status === "needs-attention" && item.DocumentIds[0] && reviewExplanation &&
              <p className="privacy-note expense-warning">Second AI review: {reviewExplanation} · Suggestion only; check the source documents.</p>}
      </div>
    </Sheet>
  </article>;
}
