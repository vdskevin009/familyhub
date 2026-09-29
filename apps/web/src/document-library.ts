import type { ReimbursementItem } from "./types";

export type DocumentLibraryKind = "invoices" | "desjardins" | "blue-cross";

/** A source document belongs to one library. Never promote an insurer statement to an invoice. */
export function libraryItems(items: ReimbursementItem[], kind: DocumentLibraryKind): ReimbursementItem[] {
  return items.filter(item => kind === "invoices"
    ? item.DocumentRole === "expense" || item.DocumentRole !== "insurer-statement"
      && ["invoice", "receipt", "bill"].includes(item.DocumentType || "")
    : item.DocumentRole === "insurer-statement" && item.Insurer === kind);
}

export function pdfAttachmentIndexes(item: ReimbursementItem): number[] {
  return item.Attachments.flatMap((attachment, index) =>
    attachment.MimeType.toLowerCase() === "application/pdf" || /\.pdf$/i.test(attachment.FileName) ? [index] : []);
}

export function documentDate(item: ReimbursementItem): string {
  return item.ServiceDate || item.StatementDate || item.ReceivedAt || "";
}
