import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, FileText, RefreshCw, Search } from "lucide-react";
import { dateLabel } from "../domain";
import { documentDate, libraryItems, pdfAttachmentIndexes, type DocumentLibraryKind } from "../document-library";
import { healthcareTitle, mergeInvoiceItems } from "../invoice-state";
import type { HubState } from "../state";
import type { ReimbursementItem } from "../types";
import { fetchInvoices, setDocumentsIgnored, viewWorkerAttachment } from "../worker";

type Props = { hub: HubState; kind: DocumentLibraryKind };
type RecordFilter = "all" | "matched" | "unmatched" | "pdf" | "no-pdf";
type StatusFilter = "all" | "active" | "ignored";

const copy = {
  invoices: { title: "Invoices", intro: "Every indexed invoice and receipt, regardless of claim or reimbursement status.", amount: "Invoice amount" },
  desjardins: { title: "Desjardins", intro: "Desjardins claim and reimbursement records from your indexed sources.", amount: "Paid by Desjardins" },
  "blue-cross": { title: "Blue Cross", intro: "Blue Cross claim and reimbursement records, including imported portal rows.", amount: "Paid by Blue Cross" }
} as const;

function money(value: number | null | undefined, code: string): string {
  if (value == null || !Number.isFinite(value)) return "Not recorded";
  try { return new Intl.NumberFormat("en-CA", { style: "currency", currency: code || "CAD" }).format(value); }
  catch { return `${value.toFixed(2)} ${code || "CAD"}`; }
}

export default function DocumentLibraryView({ hub, kind }: Props) {
  const [snapshotItems, setSnapshotItems] = useState<ReimbursementItem[] | null>(null);
  const [matchedIds, setMatchedIds] = useState<Set<string>>(() => new Set((hub.reimbursements.Reconciliations ?? []).flatMap(item => (item.MatchAssignments ?? []).map(match => match.ReimbursementDocumentId))));
  const [unmatchedIds, setUnmatchedIds] = useState<Set<string>>(() => new Set((hub.reimbursements.UnmatchedReimbursements ?? []).map(item => item.DocumentId)));
  const [ignoredSourceIds, setIgnoredSourceIds] = useState<Set<string>>(() => new Set((hub.reimbursements.IgnoredUnmatchedReimbursements ?? []).map(item => item.DocumentId)));
  const [query, setQuery] = useState("");
  const [person, setPerson] = useState("all");
  const [year, setYear] = useState("all");
  const [recordFilter, setRecordFilter] = useState<RecordFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [fromDate, setFromDate] = useState("");
  const [beforeDate, setBeforeDate] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMessage, setBulkMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState("");
  const [error, setError] = useState("");
  const paired = Boolean(hub.worker.Endpoint.trim() && hub.worker.ApiKey.trim());

  async function refresh() {
    if (!paired) return;
    setBusy(true); setError("");
    try {
      const snapshot = await fetchInvoices(hub.worker); // GET only; never starts collection.
      setSnapshotItems(snapshot.items);
      setMatchedIds(new Set(snapshot.reconciliations.flatMap(item => (item.MatchAssignments ?? []).map(match => match.ReimbursementDocumentId))));
      setUnmatchedIds(new Set(snapshot.unmatchedReimbursements.map(item => item.DocumentId)));
      setIgnoredSourceIds(new Set(snapshot.ignoredUnmatchedReimbursements.map(item => item.DocumentId)));
      if (snapshot.error) setError(snapshot.error);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load documents from the PC."); }
    finally { setBusy(false); }
  }

  useEffect(() => { void refresh(); }, [paired, hub.worker.Endpoint, hub.worker.ApiKey]);

  const items = useMemo(() => libraryItems(
    snapshotItems ? mergeInvoiceItems(hub.reimbursements.Items, snapshotItems) : hub.reimbursements.Items, kind
  ).sort((a, b) => documentDate(b).localeCompare(documentDate(a)) || a.Id.localeCompare(b.Id)),
  [snapshotItems, hub.reimbursements.Items, kind]);
  const years = useMemo(() => [...new Set(items.map(item => documentDate(item).slice(0, 4)).filter(value => /^\d{4}$/.test(value)))].sort().reverse(), [items]);
  const visible = useMemo(() => items.filter(item => {
    if (person !== "all" && (item.Member || "unknown") !== person) return false;
    const date = documentDate(item).slice(0, 10);
    if (year !== "all" && date.slice(0, 4) !== year) return false;
    if (fromDate && (!date || date < fromDate)) return false;
    if (beforeDate && (!date || date >= beforeDate)) return false;
    const ignored = kind === "invoices" ? Boolean(item.IgnoredAt) : ignoredSourceIds.has(item.Id);
    if (statusFilter === "active" && ignored || statusFilter === "ignored" && !ignored) return false;
    const pdf = pdfAttachmentIndexes(item).length > 0;
    if (recordFilter === "pdf" && !pdf || recordFilter === "no-pdf" && pdf) return false;
    if (recordFilter === "matched" && !matchedIds.has(item.Id) || recordFilter === "unmatched" && !unmatchedIds.has(item.Id)) return false;
    const text = [item.Provider, item.Healthcare?.Provider, item.Healthcare?.ServiceType, item.ClaimedService, item.Subject, item.Member, item.ServiceDate].filter(Boolean).join(" ").toLocaleLowerCase();
    return text.includes(query.trim().toLocaleLowerCase());
  }), [items, person, year, fromDate, beforeDate, statusFilter, kind, ignoredSourceIds, recordFilter, matchedIds, unmatchedIds, query]);

  const selectedItems = useMemo(() => visible.filter(item => selectedIds.has(item.Id)), [visible, selectedIds]);
  const selectedIgnored = selectedItems.filter(item => kind === "invoices" ? Boolean(item.IgnoredAt) : ignoredSourceIds.has(item.Id)).length;
  const selectedActive = selectedItems.length - selectedIgnored;
  const allVisibleSelected = visible.length > 0 && visible.every(item => selectedIds.has(item.Id));

  useEffect(() => {
    if (!selecting) {
      setSelectedIds(new Set());
      return;
    }
    const visibleIds = new Set(visible.map(item => item.Id));
    setSelectedIds(previous => new Set([...previous].filter(id => visibleIds.has(id))));
  }, [selecting, visible]);

  function toggleSelected(id: string) {
    setSelectedIds(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelectedIds(allVisibleSelected ? new Set() : new Set(visible.map(item => item.Id)));
  }

  async function changeBulkIgnored(ignored: boolean) {
    const targets = selectedItems.filter(item => {
      const itemIgnored = kind === "invoices" ? Boolean(item.IgnoredAt) : ignoredSourceIds.has(item.Id);
      return ignored ? !itemIgnored : itemIgnored;
    });
    if (!targets.length || !paired) return;
    const action = ignored ? "Ignore" : "Restore";
    if (!window.confirm(`${action} ${targets.length} selected ${targets.length === 1 ? "record" : "records"}? This changes only the exact selected document IDs and remains reversible.`)) return;
    setBulkBusy(true); setError(""); setBulkMessage("");
    try {
      await setDocumentsIgnored(hub.worker, targets.map(item => item.Id), ignored);
      setBulkMessage(`${targets.length} ${targets.length === 1 ? "record" : "records"} ${ignored ? "ignored" : "restored"}.`);
      setSelectedIds(new Set());
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The bulk status change could not be saved.");
    } finally { setBulkBusy(false); }
  }

  async function openPdf(item: ReimbursementItem, index: number) {
    setOpening(`${item.Id}:${index}`); setError("");
    try { await viewWorkerAttachment(hub.worker, item, index); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The PDF could not be opened."); }
    finally { setOpening(""); }
  }

  return <section className="document-library view-stack" aria-label={copy[kind].title}>
    <header className="library-heading">
      <div><h1>{copy[kind].title}</h1><p>{copy[kind].intro}</p></div>
      <button className="mini-button" type="button" onClick={() => void refresh()} disabled={!paired || busy} aria-label={`Refresh ${copy[kind].title}`}><RefreshCw size={16} className={busy ? "spin" : ""} /> Refresh</button>
    </header>
    <div className="library-toolbar">
      <div className="library-count"><strong>{visible.length}</strong><span>of {items.length} {kind === "invoices" ? "invoices & receipts" : "source records"}</span></div>
      <label className="library-search"><Search size={17} /><span className="sr-only">Search documents</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search provider, service or person" type="search" /></label>
      <label><span>Person</span><select value={person} onChange={event => setPerson(event.target.value)}><option value="all">All people</option><option value="Kevin">Kevin</option><option value="Jasmine">Jasmine</option><option value="Nathan">Nathan</option><option value="unknown">To confirm</option></select></label>
      <label><span>Year</span><select value={year} onChange={event => setYear(event.target.value)}><option value="all">All years</option>{years.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <label><span>From</span><input type="date" value={fromDate} onChange={event => setFromDate(event.target.value)} /></label>
      <label><span>Before</span><input type="date" value={beforeDate} onChange={event => setBeforeDate(event.target.value)} /></label>
      <label><span>Status</span><select value={statusFilter} onChange={event => setStatusFilter(event.target.value as StatusFilter)}><option value="all">All statuses</option><option value="active">Active</option><option value="ignored">Ignored</option></select></label>
      <label><span>{kind === "invoices" ? "File" : "Record"}</span><select value={recordFilter} onChange={event => setRecordFilter(event.target.value as RecordFilter)}><option value="all">All records</option>{kind === "invoices" ? <><option value="pdf">With PDF</option><option value="no-pdf">Without PDF</option></> : <><option value="matched">Matched</option><option value="unmatched">Unmatched</option><option value="pdf">With statement PDF</option></>}</select></label>
    </div>
    <div className="library-selection-toolbar">
      <button type="button" className="mini-button" disabled={!paired || bulkBusy} onClick={() => setSelecting(value => !value)}>{selecting ? "Done selecting" : "Select records"}</button>
      {selecting && <><label className="library-select-all"><input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} disabled={!visible.length || bulkBusy} /> Select all {visible.length} results</label><span>{selectedIds.size} selected</span></>}
    </div>
    {selecting && selectedItems.length > 0 && <div className="library-bulk-bar" role="region" aria-label="Bulk document actions">
      <div><strong>{selectedItems.length} selected</strong><span>{selectedActive} active · {selectedIgnored} ignored</span></div>
      <div className="library-bulk-actions">
        <button type="button" className="mini-button" disabled={!selectedActive || bulkBusy} onClick={() => void changeBulkIgnored(true)}>{bulkBusy ? "Saving…" : "Ignore selected"}</button>
        <button type="button" className="mini-button" disabled={!selectedIgnored || bulkBusy} onClick={() => void changeBulkIgnored(false)}>Restore selected</button>
      </div>
    </div>}
    {bulkMessage && <p className="library-notice" role="status">{bulkMessage}</p>}
    {!paired && <p className="library-notice">Showing documents saved on this device. Connect the FamilyHub worker in Other → Settings & tools for the latest index.</p>}
    {error && <p className="library-error" role="alert">{error}</p>}
    <div className="library-list">
      {visible.map(item => {
        const pdfIndexes = pdfAttachmentIndexes(item);
        const amount = kind === "invoices" ? item.BilledAmount ?? item.DetectedAmount : item.ReimbursedAmount;
        const ignored = kind === "invoices" ? Boolean(item.IgnoredAt) : ignoredSourceIds.has(item.Id);
        const sourceLabel = ignored ? "Ignored" : kind === "invoices" ? item.DocumentType || "Expense" : matchedIds.has(item.Id) ? "Matched" : unmatchedIds.has(item.Id) ? "Unmatched" : "Source record";
        const selected = selectedIds.has(item.Id);
        return <article className={`library-card${selected ? " selected" : ""}${ignored ? " ignored" : ""}`} key={item.Id}>
          <div className="library-card-top"><div className="library-card-label">{selecting && <input className="library-card-checkbox" type="checkbox" checked={selected} onChange={() => toggleSelected(item.Id)} disabled={bulkBusy} aria-label={`Select ${healthcareTitle({ Provider: item.Healthcare?.Provider || item.Provider, ServiceType: item.Healthcare?.ServiceType || item.ClaimedService })}`} />}<span className="library-kind"><FileText size={15} />{sourceLabel}</span></div><span>{documentDate(item) ? dateLabel(documentDate(item)) : "Date to confirm"}</span></div>
          <div className="library-card-main"><div><h2>{healthcareTitle({ Provider: item.Healthcare?.Provider || item.Provider, ServiceType: item.Healthcare?.ServiceType || item.ClaimedService })}</h2><p>{item.Member && item.Member !== "unknown" ? item.Member : "Person to confirm"}{item.Healthcare?.ServiceType || item.ClaimedService ? ` · ${item.Healthcare?.ServiceType || item.ClaimedService}` : ""}</p></div><div className="library-amount"><small>{copy[kind].amount}</small><strong>{money(amount, item.Currency)}</strong></div></div>
          {kind !== "invoices" && item.BilledAmount != null && <div className="library-detail">Submitted {money(item.BilledAmount, item.Currency)}</div>}
          <div className="library-card-bottom"><span>{pdfIndexes.length ? `${pdfIndexes.length} ${kind === "invoices" ? "invoice" : "statement"} PDF${pdfIndexes.length > 1 ? "s" : ""}` : "No PDF in this source"}</span>{pdfIndexes.length > 0 && <div className="library-pdf-actions">{pdfIndexes.map((index, ordinal) => item.DriveFileId && ordinal === 0 ? <a key={index} href={`https://drive.google.com/file/d/${encodeURIComponent(item.DriveFileId)}/view`} target="_blank" rel="noreferrer" className="mini-button"><ArrowUpRight size={15} />View {kind === "invoices" ? "invoice" : "statement"}</a> : item.WorkerManaged ? <button key={index} type="button" className="mini-button" onClick={() => void openPdf(item, index)} disabled={!paired || !!opening}><ArrowUpRight size={15} />{opening === `${item.Id}:${index}` ? "Opening…" : `View ${kind === "invoices" ? "invoice" : "statement"}${pdfIndexes.length > 1 ? ` ${ordinal + 1}` : ""}`}</button> : null)}</div>}</div>
        </article>;
      })}
      {!visible.length && <div className="library-empty"><FileText size={25} /><h2>No documents match these filters</h2><p>{items.length ? "Try another person, year or search term." : paired ? "No indexed documents are available in this section yet." : "Connect the worker to load indexed documents."}</p></div>}
    </div>
  </section>;
}
