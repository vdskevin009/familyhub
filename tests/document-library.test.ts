import assert from "node:assert/strict";
import test from "node:test";
import { documentDate, libraryItems, pdfAttachmentIndexes } from "../apps/web/src/document-library.ts";
import type { ReimbursementItem, ReconciliationCase } from "../apps/web/src/types.ts";
import { nearbySourceRecords } from "../apps/web/src/nearby-sources.ts";

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

test("nearby missing-source review uses inclusive calendar dates and the same member/source library", () => {
  const claim = { Id: "claim", Member: "Kevin", ServiceDate: "2026-03-08", DocumentIds: [] } as unknown as ReconciliationCase;
  const source = (id: string, date: string | null, patch: Partial<ReimbursementItem> = {}) => ({ ...base, Id: id, ServiceDate: date, Member: "Kevin", ...patch });
  const records = [source("before", "2026-02-26"), source("same", "2026-03-08"), source("after", "2026-03-18"),
    source("too-early", "2026-02-25"), source("too-late", "2026-03-19"), source("other-person", "2026-03-08", { Member: "Jasmine" }),
    source("unknown-date", null), source("invalid-date", "2026-02-30"),
    source("dj", "2026-03-08", { DocumentRole: "insurer-statement", Insurer: "desjardins" }),
    source("bc", "2026-03-08", { DocumentRole: "insurer-statement", Insurer: "blue-cross" })] as ReimbursementItem[];
  const before = JSON.stringify(records);
  const result = nearbySourceRecords(claim, "invoices", records, []);
  assert.deepEqual(result.rows.map(row => row.item.Id), ["same", "before", "after"]);
  assert.equal(result.from, "2026-02-26"); assert.equal(result.to, "2026-03-18");
  assert.equal(result.missingDates, 2);
  assert.deepEqual(nearbySourceRecords(claim, "desjardins", records, []).rows.map(row => row.item.Id), ["dj"]);
  assert.deepEqual(nearbySourceRecords(claim, "blue-cross", records, []).rows.map(row => row.item.Id), ["bc"]);
  assert.ok(nearbySourceRecords({ ...claim, Member: "unknown" }, "invoices", records, []).unavailable);
  assert.ok(nearbySourceRecords({ ...claim, ServiceDate: null }, "invoices", records, []).unavailable);
  assert.equal(JSON.stringify(records), before);
});

test("nearby review retains ignored and already-linked records without claiming presentation history is a current match", () => {
  const claim = { Id: "current", Member: "Kevin", ServiceDate: "2026-09-17", DocumentIds: [] } as unknown as ReconciliationCase;
  const invoice = { ...base, Id: "expense", Member: "Kevin", IgnoredAt: "2026-09-20", BilledAmount: null } as ReimbursementItem;
  const statement = { ...invoice, Id: "dj", DocumentRole: "insurer-statement", Insurer: "desjardins", ReimbursedAmount: 0 } as ReimbursementItem;
  const other = { ...claim, Id: "other", DocumentIds: [invoice.Id, statement.Id], ExpenseDocumentIds: [invoice.Id], WorkflowStatus: "closed",
    MatchAssignments: [{ ReimbursementDocumentId: statement.Id }] } as ReconciliationCase;
  const stale = { ...other, Id: "stale", PreviouslyFound: true };
  const projected = { ...other, Id: "projected", InferredFromInsurer: true };
  assert.deepEqual(nearbySourceRecords(claim, "invoices", [invoice, statement], [other, stale, projected]).rows[0].links.map(x => x.Id), ["other"]);
  const row = nearbySourceRecords(claim, "desjardins", [invoice, statement], [other, stale, projected]).rows[0];
  assert.deepEqual(row.links.map(x => x.Id), ["other"]);
  assert.equal(row.item.ReimbursedAmount, 0);
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
