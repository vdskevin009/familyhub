import assert from "node:assert/strict";
import test from "node:test";
import { documentDate, libraryItems, pdfAttachmentIndexes } from "../apps/web/src/document-library.ts";
import type { ReimbursementItem } from "../apps/web/src/types.ts";

const base = {
  Id: "source", DocumentRole: "expense", DocumentType: "invoice", Insurer: null,
  ServiceDate: "2026-09-17", ReceivedAt: "2026-09-20T12:00:00Z", Attachments: []
} as unknown as ReimbursementItem;

test("source libraries keep invoices separate from insurer statements", () => {
  const expense = { ...base, Id: "expense", Status: 3 } as ReimbursementItem;
  const blueCross = { ...base, Id: "bc", DocumentRole: "insurer-statement", DocumentType: "claim", Insurer: "blue-cross", ReimbursedAmount: null } as ReimbursementItem;
  const desjardins = { ...base, Id: "dj", DocumentRole: "insurer-statement", DocumentType: "claim", Insurer: "desjardins" } as ReimbursementItem;
  const records = [expense, blueCross, desjardins];
  assert.deepEqual(libraryItems(records, "invoices").map(item => item.Id), ["expense"]);
  assert.deepEqual(libraryItems(records, "blue-cross").map(item => item.Id), ["bc"]);
  assert.deepEqual(libraryItems(records, "desjardins").map(item => item.Id), ["dj"]);
});

test("PDF availability uses attachment metadata without reading content", () => {
  const item = { ...base, Attachments: [
    { Id: "image", FileName: "image.png", MimeType: "image/png", Size: 10 },
    { Id: "one", FileName: "invoice.PDF", MimeType: "application/octet-stream", Size: 20 },
    { Id: "two", FileName: "document", MimeType: "application/pdf", Size: 30 }
  ] } as ReimbursementItem;
  assert.deepEqual(pdfAttachmentIndexes(item), [1, 2]);
  assert.equal(documentDate(item), "2026-09-17");
});
