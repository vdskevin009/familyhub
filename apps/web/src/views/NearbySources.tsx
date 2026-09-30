import { useMemo, useState } from "react";
import { dateLabel } from "../domain";
import { pdfAttachmentIndexes, type DocumentLibraryKind } from "../document-library";
import { googleBridge } from "../google";
import { healthcareTitle, type ReimbursementInvoicePdfOption } from "../invoice-state";
import { nearbyInvoiceLink, nearbyReimbursementLink, nearbySourceRecords, sourceLabels } from "../nearby-sources";
import type { ReconciliationCase, ReimbursementItem } from "../types";

function money(value: number | null | undefined, currency: string) {
  if (value == null || !Number.isFinite(value)) return "Not recorded";
  try { return new Intl.NumberFormat("en-CA", { style: "currency", currency: currency || "CAD" }).format(value); }
  catch { return `${value.toFixed(2)} ${currency}`; }
}

export default function NearbySources({ claim, kind, onKindChange, items, cases, ignoredIds, paired, savingId, openPdf,
  unmatchedIds = new Set<string>(), onLink, manualActionsAvailable = false }: {
  claim: ReconciliationCase; kind: DocumentLibraryKind; onKindChange: (kind: DocumentLibraryKind) => void;
  items: ReimbursementItem[]; cases: ReconciliationCase[]; ignoredIds: ReadonlySet<string>;
  paired: boolean; savingId: string; openPdf: (option: ReimbursementInvoicePdfOption) => Promise<void>;
  unmatchedIds?: ReadonlySet<string>; manualActionsAvailable?: boolean;
  onLink?: (target: ReconciliationCase, reimbursementId: string) => Promise<boolean>;
}) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState("");
  const result = useMemo(() => nearbySourceRecords(claim, kind, items, cases), [claim, kind, items, cases]);
  return <section className="nearby-sources" aria-label="Nearby source records">
    <div><h3>Check nearby records</h3><p>Same person · 10 days before or after this service. Linked records are included so you can check possible mistakes.</p></div>
    <div className="nearby-source-tabs" role="group" aria-label="Source to review">
      {(Object.keys(sourceLabels) as DocumentLibraryKind[]).map(source => <button key={source} type="button" className="mini-button"
        aria-pressed={kind === source} onClick={() => onKindChange(source)}>{sourceLabels[source]}</button>)}
    </div>
    {result.unavailable ? <p role="status">{result.unavailable}</p> : <>
      <p className="nearby-source-range">{claim.Member} · {dateLabel(result.from!)} – {dateLabel(result.to!)} · {result.rows.length} record{result.rows.length === 1 ? "" : "s"}</p>
      {!result.rows.length && <p>No {sourceLabels[kind]} records found in this date range in your saved sources.</p>}
      <div className="nearby-source-list">{result.rows.map(({ item, serviceDate, offsetDays, links }) => {
        const pdfs = pdfAttachmentIndexes(item);
        const service = item.Healthcare?.ServiceType || item.ClaimedService;
        const reference = item.Healthcare?.InvoiceNumber || item.PortalClaimId || item.Healthcare?.ClaimReference;
        const paid = item.ReimbursedAmount ?? null;
        const amount = kind === "invoices" ? item.BilledAmount ?? item.Healthcare?.OriginalBilledAmount : item.Healthcare?.SubmittedAmount ?? item.BilledAmount;
        const link = !onLink ? null : kind !== "invoices"
          ? nearbyReimbursementLink(claim, item, cases, unmatchedIds, ignoredIds)
          : claim.InferredFromInsurer && claim.OriginalInvoiceMissing
            ? nearbyInvoiceLink(claim, item, items, cases, unmatchedIds, ignoredIds) : null;
        const linkLabel = kind === "invoices" ? "Link this invoice" : "Link this reimbursement";
        const targetInvoice = link?.target && items.find(source => source.Id === link.target.ExpenseDocumentId);
        return <article className="nearby-source-record" key={item.Id}>
          <div><strong>{healthcareTitle({ Provider: item.Healthcare?.Provider || item.Provider, ServiceType: service })}</strong>
            <p>{dateLabel(serviceDate)} · {offsetDays === 0 ? "Same day" : `${Math.abs(offsetDays)} days ${offsetDays < 0 ? "before" : "after"}`}</p>
            {service && <p>{service}</p>}{reference && <small>Reference: {reference}</small>}</div>
          <dl className="nearby-source-amounts"><div><dt>{kind === "invoices" ? "Invoice amount" : "Submitted"}</dt><dd>{money(amount, item.Currency)}</dd></div>
            {kind !== "invoices" && <div><dt>Reimbursed</dt><dd>{money(paid, item.Currency)}</dd></div>}</dl>
          {link && <div className="nearby-invoice-link">
            {link.reason ? <><button type="button" className="mini-button" disabled>{linkLabel}</button><small>{link.reason}</small></> : confirmId === item.Id ? <div className="nearby-source-link" role="group" aria-label="Confirm invoice link">
              <strong>{kind === "invoices" ? "Link this invoice to the insurer payment?" : "Link this reimbursement to this invoice?"}</strong>
              <span>{claim.Member} · {dateLabel(claim.ServiceDate!)} · {link.reimbursement!.Insurer === "blue-cross" ? "Blue Cross" : "Desjardins"} {money(link.reimbursement!.ReimbursedAmount, claim.Currency)}</span>
              <span>Invoice: {healthcareTitle(link.target!)}{targetInvoice?.Healthcare?.InvoiceNumber ? ` · ${targetInvoice.Healthcare.InvoiceNumber}` : ""}</span>
              <small>The payment will join this invoice’s expense. Other claims and saved status choices stay unchanged.</small>
              <div className="nearby-source-actions"><button type="button" className="mini-button primary" disabled={!paired || !manualActionsAvailable || !!savingId || linking}
                onClick={async () => {
                  setLinking(true); setLinkError("");
                  try {
                    if (await onLink!(link.target!, link.reimbursement!.Id)) setConfirmId(null);
                    else setLinkError("The link was not confirmed. Review the message above and refresh before trying again.");
                  } catch { setLinkError("The link could not be confirmed. Refresh before trying again."); }
                  finally { setLinking(false); }
                }}>{linking ? "Linking…" : "Confirm link"}</button>
                <button type="button" className="mini-button" disabled={linking || !!savingId} onClick={() => { setConfirmId(null); setLinkError(""); }}>Cancel</button></div>
              {linkError && <small role="alert">{linkError}</small>}
            </div> : <button type="button" className="mini-button primary" disabled={!paired || !manualActionsAvailable || !!savingId || linking}
              onClick={() => { setConfirmId(item.Id); setLinkError(""); }}>{manualActionsAvailable ? linkLabel : "Update PC worker to link"}</button>}
          </div>}
          {links.length ? links.map(link => <div className="nearby-source-link" key={link.Id}>
            <strong>{link.Id === claim.Id ? "Linked to this claim" : "Linked to another claim"}</strong>
            <span>{healthcareTitle(link)} · {link.ServiceDate ? dateLabel(link.ServiceDate) : "Date unknown"} · Expense {money(link.OriginalAmount, link.Currency)}</span>
            <small>Status: {link.WorkflowStatus || "not recorded"}{link.WorkflowOrigin === "manual" ? " · Manual decision" : ""}</small>
          </div>) : <p className="nearby-source-link">No current expense link recorded</p>}
          {(item.IgnoredAt || item.Status === 4 || ignoredIds.has(item.Id)) && <small>Ignored source · included for review</small>}
          {item.NeedsReview && <small>Source needs review</small>}
          {item.PortalClaimStatus && <small>Insurer status: {item.PortalClaimStatus}</small>}
          <div className="nearby-source-actions">
            {item.AccountEmail && /^[a-f0-9]+$/i.test(item.SourceMessageId || "") && <button type="button" className="mini-button" onClick={() => googleBridge.openMessage(item.AccountEmail, item.InternetMessageId, item.SourceMessageId)}>Source email</button>}
            {item.DriveFileId && <a className="mini-button" href={`https://drive.google.com/file/d/${encodeURIComponent(item.DriveFileId)}/view`} target="_blank" rel="noreferrer">Archived document</a>}
            {item.WorkerManaged && pdfs.map((index, ordinal) => <button key={index} type="button" className="mini-button" disabled={!paired || !!savingId}
              onClick={() => void openPdf({ ItemId: item.Id, AttachmentIndex: index, FileName: item.Attachments[index].FileName, Source: "worker" })}>
              {savingId === `pdf:${item.Id}:${index}` ? "Opening…" : `View PDF${pdfs.length > 1 ? ` ${ordinal + 1}` : ""}`}</button>)}
          </div>

        </article>;
      })}</div>
      {result.missingDates > 0 && <small>{result.missingDates} other {sourceLabels[kind]} record{result.missingDates === 1 ? " has" : "s have"} no service date and cannot be placed in this window.</small>}
    </>}
    <p className="privacy-note">Saved sources may be incomplete; a nearby date does not prove a match. Links change only when you confirm. No insurance claim is submitted.</p>
  </section>;
}
