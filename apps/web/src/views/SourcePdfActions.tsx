import { ExternalLink } from "lucide-react";
import { sourcePdfOptions, type ReimbursementInvoicePdfOption } from "../invoice-state";
import type { ReimbursementItem } from "../types";
import { pdfAttachmentIndexes } from "../document-library";

/** Only this exact source's original attachments; never infer a PDF from a nearby record. */
export default function SourcePdfActions({ item, paired, savingId, openPdf, label = "Open PDF" }: {
  item: ReimbursementItem; paired: boolean; savingId: string;
  openPdf: (option: ReimbursementInvoicePdfOption) => Promise<void>; label?: string;
}) {
  const options = sourcePdfOptions(item);
  if (!options.length) return <small className="source-pdf-unavailable">{pdfAttachmentIndexes(item).length ? "PDF unavailable here; open the source email." : "No PDF attachment"}</small>;
  return <div className="source-pdf-actions" aria-label="Original PDF attachments">
    {options.map(option => option.Source === "drive" && option.Url
      ? <a className="mini-button subtle" key={`${option.ItemId}:${option.AttachmentIndex}`} href={option.Url} target="_blank" rel="noreferrer">
          <ExternalLink size={14} aria-hidden="true" />{options.length === 1 ? label : option.FileName}
        </a>
      : <button type="button" className="mini-button subtle" key={`${option.ItemId}:${option.AttachmentIndex}`}
          disabled={!paired || !!savingId} onClick={() => void openPdf(option)}
          title={!paired ? "Connect your paired PC to open this PDF" : option.FileName}>
          <ExternalLink size={14} aria-hidden="true" />{savingId === `pdf:${option.ItemId}:${option.AttachmentIndex}` ? "Opening…" : options.length === 1 ? label : option.FileName}
        </button>)}
    {!paired && options.some(option => option.Source === "worker") && <small>Connect your paired PC to open the PDF.</small>}
  </div>;
}
