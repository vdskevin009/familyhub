import assert from "node:assert/strict";
import test from "node:test";
import { documentDate, libraryItems, pdfAttachmentIndexes } from "../apps/web/src/document-library.ts";
import type { ReimbursementItem, ReconciliationCase } from "../apps/web/src/types.ts";
import { nearbyInvoiceLink, nearbyReimbursementLink, nearbySourceRecords } from "../apps/web/src/nearby-sources.ts";

const base = {
  Id: "source", DocumentRole: "expense", DocumentType: "invoice", Insurer: null,
  ServiceDate: "2026-09-17", ReceivedAt: "2026-09-20T12:00:00Z", Attachments: []
} as unknown as ReimbursementItem;

test("missing invoice linking uses the existing expense identity despite different service wording or unknown price", () => {
  const invoice = { ...base, Id: "receipt", Member: "Kevin", BilledAmount: null, Healthcare: { ServiceType: "RMT follow-up" } } as ReimbursementItem;
  const payment = { ...base, Id: "payment", Member: "Kevin", DocumentRole: "insurer-statement", Insurer: "blue-cross" } as ReimbursementItem;
  const claim = { Id: "insurer-evidence:payment", Member: "Kevin", ServiceDate: base.ServiceDate, DocumentIds: [payment.Id],
    InferredFromInsurer: true, OriginalInvoiceMissing: true } as ReconciliationCase;
  const target = { ...claim, Id: "expense", ExpenseDocumentId: invoice.Id, ExpenseDocumentIds: [invoice.Id], DocumentIds: [invoice.Id],
    InferredFromInsurer: false, OriginalInvoiceMissing: false, WorkflowStatus: "closed", WorkflowOrigin: "manual" } as ReconciliationCase;
  const check = (patch: Partial<ReconciliationCase> = {}, unmatched = new Set([payment.Id]), ignored = new Set<string>()) =>
    nearbyInvoiceLink(claim, invoice, [invoice, payment], [{ ...target, ...patch }], unmatched, ignored);
  assert.equal(check().target?.ExpenseDocumentId, invoice.Id);
  assert.equal(check().target?.WorkflowStatus, "closed", "link must preserve saved status choice");
  assert.equal(check().reimbursement?.Id, payment.Id);
  assert.match(check({ ServiceDate: "2026-09-18" }).reason!, /same service date/);
  assert.match(check({ Member: "Jasmine" }).reason!, /same confirmed family member/);
  assert.ok(check({ PreviouslyFound: true }).reason);
  assert.ok(check({ WorkflowStatus: "ignore" }).reason);
  assert.ok(check({}, new Set()).reason);
  assert.ok(check({}, undefined, new Set([invoice.Id])).reason);
  assert.ok(check({ MatchAssignments: [{ Insurer: "blue-cross", ReimbursementDocumentId: "other" } as never] }).reason);
  assert.ok(check({ MatchAssignments: [{ Insurer: "desjardins", ReimbursementDocumentId: payment.Id } as never] }).reason);
  assert.equal(check({ MatchAssignments: [{ Insurer: "desjardins", ReimbursementDocumentId: "other" } as never] }).reason, null);
  assert.ok(nearbyInvoiceLink(claim, invoice, [invoice, payment], [target, { ...target, Id: "duplicate" }], new Set([payment.Id]), new Set()).reason);
});

test("source libraries keep invoices separate from insurer statements", () => {
  const expense = { ...base, Id: "expense", Status: 3 } as ReimbursementItem;
  const blueCross = { ...base, Id: "bc", DocumentRole: "insurer-statement", DocumentType: "claim", Insurer: "blue-cross", ReimbursedAmount: null } as ReimbursementItem;
  const desjardins = { ...base, Id: "dj", DocumentRole: "insurer-statement", DocumentType: "claim", Insurer: "desjardins" } as ReimbursementItem;
  const records = [expense, blueCross, desjardins];
  assert.deepEqual(libraryItems(records, "invoices").map(item => item.Id), ["expense"]);
  assert.deepEqual(libraryItems(records, "blue-cross").map(item => item.Id), ["bc"]);
  assert.deepEqual(libraryItems(records, "desjardins").map(item => item.Id), ["dj"]);
});

test("insurer tabs link an unmatched payment to the current expense and explain unsafe choices", () => {
  const target = { Id: "case", ExpenseDocumentId: "invoice", ExpenseDocumentIds: ["invoice"], DocumentIds: ["invoice"],
    Member: "Kevin", ServiceDate: base.ServiceDate, WorkflowStatus: "open", ServiceType: "RMT follow-up" } as ReconciliationCase;
  for (const insurer of ["blue-cross", "desjardins"] as const) {
    const payment = { ...base, Id: insurer, Member: "Kevin", DocumentRole: "insurer-statement", DocumentType: "claim", Insurer: insurer,
      ClaimedService: "Registered massage", ReimbursedAmount: 80 } as ReimbursementItem;
    const check = (patch: Partial<ReconciliationCase> = {}, ids = new Set([payment.Id]), ignored = new Set<string>()) =>
      nearbyReimbursementLink(target, payment, [{ ...target, ...patch }], ids, ignored);
    assert.equal(check().target?.ExpenseDocumentId, "invoice");
    assert.equal(check().reimbursement?.Id, payment.Id);
    assert.ok(check({}, new Set()).reason);
    assert.ok(check({}, undefined, new Set([payment.Id])).reason);
    assert.match(check({ ServiceDate: "2026-09-18" }).reason!, /same service date/);
    assert.match(check({ Member: "Nathan" }).reason!, /same confirmed family member/);
    assert.ok(check({ PreviouslyFound: true }).reason);
    assert.ok(check({ WorkflowStatus: "ignore" }).reason);
    assert.ok(nearbyReimbursementLink({ ...target, InferredFromInsurer: true }, payment, [target], new Set([payment.Id]), new Set()).reason);
    assert.match(check({ MatchAssignments: [{ ReimbursementDocumentId: payment.Id, Insurer: insurer } as never] }).reason!, /Already linked to this claim/);
    const other = { ...target, Id: "other", ExpenseDocumentId: "other-invoice", ExpenseDocumentIds: ["other-invoice"], MatchAssignments: [{ ReimbursementDocumentId: payment.Id, Insurer: insurer } as never] };
    assert.match(nearbyReimbursementLink(target, payment, [target, other], new Set([payment.Id]), new Set()).reason!, /Linked to another claim/);
    assert.ok(check({ MatchAssignments: [{ ReimbursementDocumentId: "other-payment", Insurer: insurer } as never] }).reason);
  }
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
