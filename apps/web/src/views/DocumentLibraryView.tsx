import { FilterButton, FilterChips, Notice, PageHeader, SearchField, Sheet, SkeletonList, useSessionValue, type ActiveFilter } from "../ui/primitives";
import { requireSaved } from "../ui/mutation-queue";
import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, ExternalLink, FileText, RefreshCw, Search } from "lucide-react";
import { dateLabel } from "../domain";
import { documentDate, excludedInvoiceCandidates, libraryItems, pdfAttachmentIndexes, type DocumentLibraryKind } from "../document-library";
import { googleBridge } from "../google";
import { healthcareTitle, mergeInvoiceItems } from "../invoice-state";
import type { HubState } from "../state";
import type { ReimbursementItem } from "../types";
import { correctInvoice, fetchInvoices, setDocumentsIgnored, viewWorkerAttachment } from "../worker";

type Props = { hub: HubState; kind: DocumentLibraryKind };
type RecordFilter = "all" | "matched" | "unmatched" | "pdf" | "no-pdf";
type StatusFilter = "all" | "active" | "ignored";
type LibraryMode = "included" | "excluded";

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

function classificationLabel(value: ReimbursementItem["DocumentType"]): string {
  if (!value) return "Other";
  return value === "administrative" ? "Administrative" : value[0].toUpperCase() + value.slice(1);
}

export default function DocumentLibraryView({ hub, kind }: Props) {
  const [snapshotItems, setSnapshotItems] = useState<ReimbursementItem[] | null>(null);
  const [matchedIds, setMatchedIds] = useState<Set<string>>(() => new Set((hub.reimbursements.Reconciliations ?? []).flatMap(item => (item.MatchAssignments ?? []).map(match => match.ReimbursementDocumentId))));
  const [unmatchedIds, setUnmatchedIds] = useState<Set<string>>(() => new Set((hub.reimbursements.UnmatchedReimbursements ?? []).map(item => item.DocumentId)));
  const [ignoredSourceIds, setIgnoredSourceIds] = useState<Set<string>>(() => new Set((hub.reimbursements.IgnoredUnmatchedReimbursements ?? []).map(item => item.DocumentId)));
  const [libraryMode, setLibraryMode] = useSessionValue<LibraryMode>(`library.${kind}.mode`, "included", (value): value is LibraryMode => value === "included" || value === "excluded");
  const [query, setQuery] = useSessionValue(`library.${kind}.query`, "", (value): value is string => typeof value === "string");
  const [person, setPerson] = useSessionValue(`library.${kind}.person`, "all", (value): value is string => typeof value === "string");
  const [year, setYear] = useSessionValue(`library.${kind}.year`, "all", (value): value is string => typeof value === "string");
  const [recordFilter, setRecordFilter] = useSessionValue<RecordFilter>(`library.${kind}.record`, "all", (value): value is RecordFilter => ["all", "matched", "unmatched", "pdf", "no-pdf"].includes(value as string));
  const [statusFilter, setStatusFilter] = useSessionValue<StatusFilter>(`library.${kind}.status`, "all", (value): value is StatusFilter => ["all", "active", "ignored"].includes(value as string));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [fromDate, setFromDate] = useSessionValue(`library.${kind}.fromDate`, "", (value): value is string => typeof value === "string");
  const [beforeDate, setBeforeDate] = useSessionValue(`library.${kind}.beforeDate`, "", (value): value is string => typeof value === "string");
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMessage, setBulkMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState("");
  const [error, setError] = useState("");
  const [reviewing, setReviewing] = useState("");
  const [reviewMessage, setReviewMessage] = useState("");
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

  const indexedItems = useMemo(
    () => snapshotItems ? mergeInvoiceItems(hub.reimbursements.Items, snapshotItems) : hub.reimbursements.Items,
    [snapshotItems, hub.reimbursements.Items]
  );
  const includedItems = useMemo(() => libraryItems(indexedItems, kind)
    .sort((a, b) => documentDate(b).localeCompare(documentDate(a)) || a.Id.localeCompare(b.Id)), [indexedItems, kind]);
  const excludedItems = useMemo(() => kind === "invoices" ? excludedInvoiceCandidates(indexedItems)
    .sort((a, b) => documentDate(b).localeCompare(documentDate(a)) || a.Id.localeCompare(b.Id)) : [], [indexedItems, kind]);
  const exclusionMode = kind === "invoices" && libraryMode === "excluded";
  const items = exclusionMode ? excludedItems : includedItems;
  const years = useMemo(() => [...new Set(items.map(item => documentDate(item).slice(0, 4)).filter(value => /^\d{4}$/.test(value)))].sort().reverse(), [items]);
  const visible = useMemo(() => items.filter(item => {
    if (person !== "all" && (item.Member || "unknown") !== person) return false;
    const date = documentDate(item).slice(0, 10);
    if (year !== "all" && date.slice(0, 4) !== year) return false;
    if (fromDate && (!date || date < fromDate)) return false;
    if (beforeDate && (!date || date >= beforeDate)) return false;
    if (!exclusionMode) {
      const ignored = kind === "invoices" ? Boolean(item.IgnoredAt) : ignoredSourceIds.has(item.Id);
      if (statusFilter === "active" && ignored || statusFilter === "ignored" && !ignored) return false;
      const pdf = pdfAttachmentIndexes(item).length > 0;
      if (recordFilter === "pdf" && !pdf || recordFilter === "no-pdf" && pdf) return false;
      if (recordFilter === "matched" && !matchedIds.has(item.Id) || recordFilter === "unmatched" && !unmatchedIds.has(item.Id)) return false;
    }
    const text = [item.Provider, item.Healthcare?.Provider, item.Healthcare?.ServiceType, item.ClaimedService, item.Subject, item.Sender, item.Member, item.ServiceDate, ...(item.Reasons ?? [])].filter(Boolean).join(" ").toLocaleLowerCase();
    return text.includes(query.trim().toLocaleLowerCase());
  }), [items, person, year, fromDate, beforeDate, statusFilter, kind, ignoredSourceIds, recordFilter, matchedIds, unmatchedIds, query, exclusionMode]);

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

  useEffect(() => {
    if (exclusionMode) setSelecting(false);
  }, [exclusionMode]);

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
      requireSaved(await setDocumentsIgnored(hub.worker, targets.map(item => item.Id), ignored));
      setBulkMessage(`${targets.length} ${targets.length === 1 ? "record" : "records"} ${ignored ? "ignored" : "restored"}.`);
      setSelectedIds(new Set());
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The bulk status change could not be saved.");
    } finally { setBulkBusy(false); }
  }

  async function reclassifyExcluded(item: ReimbursementItem, nextKind: "invoice" | "receipt" | "bill") {
    if (!paired) return;
    setReviewing(item.Id); setError(""); setReviewMessage("");
    try {
      const result = await correctInvoice(hub.worker, item.Id, nextKind);
      setSnapshotItems(previous => previous ? mergeInvoiceItems(previous, [result]) : [result]);
      hub.setReimbursements(previous => ({ ...previous, Items: mergeInvoiceItems(previous.Items, [result]) }));
      setReviewMessage(`${item.Subject || item.Sender || "Candidate"} is now marked as ${nextKind} and has moved into Invoices.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The classification could not be saved.");
    } finally { setReviewing(""); }
  }

  async function openPdf(item: ReimbursementItem, index: number) {
    setOpening(`${item.Id}:${index}`); setError("");
    try { await viewWorkerAttachment(hub.worker, item, index); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The PDF could not be opened."); }
    finally { setOpening(""); }
  }

  function resetFilters() { setPerson("all"); setYear("all"); setFromDate(""); setBeforeDate(""); setStatusFilter("all"); setRecordFilter("all"); setQuery(""); }
  const activeFilters: ActiveFilter[] = [
    ...(person !== "all" ? [{ id: "person", label: person === "unknown" ? "Person to confirm" : person, clear: () => setPerson("all") }] : []),
    ...(year !== "all" ? [{ id: "year", label: year, clear: () => setYear("all") }] : []),
    ...(fromDate ? [{ id: "from", label: `From ${fromDate}`, clear: () => setFromDate("") }] : []),
    ...(beforeDate ? [{ id: "before", label: `Before ${beforeDate}`, clear: () => setBeforeDate("") }] : []),
    ...(!exclusionMode && statusFilter !== "all" ? [{ id: "status", label: statusFilter === "ignored" ? "Ignored" : "Active", clear: () => setStatusFilter("all") }] : []),
    ...(!exclusionMode && recordFilter !== "all" ? [{ id: "record", label: { matched: "Matched", unmatched: "Unmatched", pdf: "With PDF", "no-pdf": "Without PDF" }[recordFilter], clear: () => setRecordFilter("all") }] : [])
  ];

  return <section className="document-library view-stack" aria-label={copy[kind].title}>
    <PageHeader title={copy[kind].title} subtitle={exclusionMode ? `${visible.length} of ${items.length} excluded candidates` : `${visible.length} of ${items.length} ${kind === "invoices" ? "invoices & receipts" : "source records"}`}>
      <button type="button" className="icon-button" onClick={() => void refresh()} disabled={!paired || busy || bulkBusy || !!reviewing} aria-label={`Refresh ${copy[kind].title}`}><RefreshCw size={18} className={busy ? "spin" : ""} /></button>
    </PageHeader>
    {kind === "invoices" && <div className="library-mode-tabs" role="tablist" aria-label="Invoice index view">
      <button type="button" role="tab" aria-selected={!exclusionMode} className={!exclusionMode ? "active" : ""} onClick={() => setLibraryMode("included")}><span>Invoices</span><strong>{includedItems.length}</strong></button>
      <button type="button" role="tab" aria-selected={exclusionMode} className={exclusionMode ? "active" : ""} onClick={() => setLibraryMode("excluded")}><span>Excluded</span><strong>{excludedItems.length}</strong></button>
    </div>}
    <div className="workspace-controls">
      <div className="search-filter-row"><SearchField value={query} onChange={setQuery} label={exclusionMode ? "Search excluded candidates" : "Search documents"} placeholder={exclusionMode ? "Search excluded mail…" : "Search documents…"} /><FilterButton count={activeFilters.length} onClick={() => setFiltersOpen(true)} /></div>
      <FilterChips filters={activeFilters} onReset={resetFilters} />
    </div>
    <Sheet open={filtersOpen} onClose={() => setFiltersOpen(false)} title={exclusionMode ? "Filter excluded candidates" : `Filter ${copy[kind].title.toLowerCase()}`} description={exclusionMode ? "Messages FamilyHub examined and deliberately kept out of Invoices." : copy[kind].intro}
      footer={<><button type="button" className="button secondary" onClick={resetFilters}>Reset</button><button type="button" className="button" onClick={() => setFiltersOpen(false)}>Show {visible.length} records</button></>}>
      <div className="filter-form">
      <label><span>Person</span><select value={person} onChange={event => setPerson(event.target.value)}><option value="all">All people</option><option value="Kevin">Kevin</option><option value="Jasmine">Jasmine</option><option value="Nathan">Nathan</option><option value="unknown">To confirm</option></select></label>
      <label><span>Year</span><select value={year} onChange={event => setYear(event.target.value)}><option value="all">All years</option>{years.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <label><span>From</span><input type="date" value={fromDate} onChange={event => setFromDate(event.target.value)} /></label>
      <label><span>Before</span><input type="date" value={beforeDate} onChange={event => setBeforeDate(event.target.value)} /></label>
      {!exclusionMode && <><label><span>Status</span><select value={statusFilter} onChange={event => setStatusFilter(event.target.value as StatusFilter)}><option value="all">All statuses</option><option value="active">Active</option><option value="ignored">Ignored</option></select></label>
      <label><span>{kind === "invoices" ? "File" : "Record"}</span><select value={recordFilter} onChange={event => setRecordFilter(event.target.value as RecordFilter)}><option value="all">All records</option>{kind === "invoices" ? <><option value="pdf">With PDF</option><option value="no-pdf">Without PDF</option></> : <><option value="matched">Matched</option><option value="unmatched">Unmatched</option><option value="pdf">With statement PDF</option></>}</select></label></>}
      </div>
      <p className="privacy-note">“From” includes that date. “Before” excludes that date.</p>
    </Sheet>
    {!exclusionMode && <div className="library-selection-toolbar">
      <button type="button" className="mini-button" disabled={!paired || bulkBusy} onClick={() => setSelecting(value => !value)}>{selecting ? "Done selecting" : "Select records"}</button>
      {selecting && <><label className="library-select-all"><input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} disabled={!visible.length || bulkBusy} /> Select all {visible.length} results</label><span>{selectedIds.size} selected</span></>}
    </div>}
    {!exclusionMode && selecting && selectedItems.length > 0 && <div className="library-bulk-bar" role="region" aria-label="Bulk document actions">
      <div><strong>{selectedItems.length} selected</strong><span>{selectedActive} active · {selectedIgnored} ignored</span></div>
      <div className="library-bulk-actions">
        <button type="button" className="mini-button" disabled={!selectedActive || bulkBusy} onClick={() => void changeBulkIgnored(true)}>{bulkBusy ? "Saving…" : "Ignore selected"}</button>
        <button type="button" className="mini-button" disabled={!selectedIgnored || bulkBusy} onClick={() => void changeBulkIgnored(false)}>Restore selected</button>
      </div>
    </div>}
    {bulkMessage && <Notice onDismiss={() => setBulkMessage("")}>{bulkMessage}</Notice>}
    {reviewMessage && <Notice onDismiss={() => setReviewMessage("")}>{reviewMessage}</Notice>}
    {!paired && <p className="library-notice">Showing documents saved on this device. Connect the FamilyHub worker in Other → Settings & tools for the latest index.</p>}
    {error && <Notice error onDismiss={() => setError("")}>{error}</Notice>}
    {busy && !items.length && <SkeletonList label="Loading documents" />}
    <div className="library-list">
      {visible.map(item => {
        if (exclusionMode) {
          const reason = item.Reasons?.find(Boolean) || item.AttentionReason || "No classification reason was recorded.";
          const sourceAvailable = Boolean(item.AccountEmail && item.SourceMessageId);
          const pending = reviewing === item.Id;
          return <article className="library-card excluded-candidate" key={item.Id}>
            <div className="library-card-top"><span className="library-kind"><FileText size={15} />Excluded · {classificationLabel(item.DocumentType)}</span><span>{documentDate(item) ? dateLabel(documentDate(item)) : "Date unavailable"}</span></div>
            <div className="excluded-candidate-main"><div><h2>{item.Subject || item.Provider || "Untitled message"}</h2><p>{item.Sender || "Unknown sender"}{item.AccountLabel ? ` · ${item.AccountLabel}` : ""}</p></div><span className="excluded-confidence">{Number.isFinite(item.Confidence) ? `${item.Confidence}% confidence` : "Confidence unavailable"}</span></div>
            <div className="excluded-reason"><small>Why FamilyHub excluded it</small><p>{reason}</p></div>
            <div className="excluded-actions">
              {sourceAvailable && <button type="button" className="mini-button subtle" onClick={() => googleBridge.openMessage(item.AccountEmail, item.InternetMessageId, item.SourceMessageId)}><ExternalLink size={14} />Source email</button>}
              <span className="excluded-action-label">Wrong? Mark as</span>
              <button type="button" className="mini-button" disabled={!paired || pending} onClick={() => void reclassifyExcluded(item, "invoice")}>{pending ? "Saving…" : "Invoice"}</button>
              <button type="button" className="mini-button" disabled={!paired || pending} onClick={() => void reclassifyExcluded(item, "receipt")}>Receipt</button>
              <button type="button" className="mini-button" disabled={!paired || pending} onClick={() => void reclassifyExcluded(item, "bill")}>Bill</button>
            </div>
          </article>;
        }
        const pdfIndexes = pdfAttachmentIndexes(item);
        const amount = kind === "invoices" ? item.BilledAmount ?? item.DetectedAmount : item.ReimbursedAmount;
        const ignored = kind === "invoices" ? Boolean(item.IgnoredAt) : ignoredSourceIds.has(item.Id);
        const sourceLabel = ignored ? "Ignored" : kind === "invoices" ? item.DocumentType || "Expense" : matchedIds.has(item.Id) ? "Matched" : unmatchedIds.has(item.Id) ? "Unmatched" : "Source record";
        const selected = selectedIds.has(item.Id);
        return <article className={`library-card${selected ? " selected" : ""}${ignored ? " ignored" : ""}`} key={item.Id}>
          <div className="library-card-top"><div className="library-card-label">{selecting && <input className="library-card-checkbox" type="checkbox" checked={selected} onChange={() => toggleSelected(item.Id)} disabled={bulkBusy} aria-label={`Select ${healthcareTitle({ Provider: item.Healthcare?.Provider || item.Provider, ServiceType: item.Healthcare?.ServiceType || item.ClaimedService })}`} />}<span className="library-kind"><FileText size={15} />{sourceLabel}</span></div><span>{documentDate(item) ? dateLabel(documentDate(item)) : "Date to confirm"}</span></div>
          <div className="library-card-main"><div><h2>{healthcareTitle({ Provider: item.Healthcare?.Provider || item.Provider, ServiceType: item.Healthcare?.ServiceType || item.ClaimedService })}</h2><p>{item.Member && item.Member !== "unknown" ? item.Member : "Person to confirm"}{item.Healthcare?.ServiceType || item.ClaimedService ? ` · ${item.Healthcare?.ServiceType || item.ClaimedService}` : ""}</p></div><div className="library-amount"><small>{copy[kind].amount}</small><strong>{money(amount, item.Currency)}</strong></div></div>
          {kind !== "invoices" && item.BilledAmount != null && <div className="library-detail">Submitted {money(item.BilledAmount, item.Currency)}</div>}
          <div className="library-card-bottom"><span>{pdfIndexes.length ? `${pdfIndexes.length} PDF${pdfIndexes.length > 1 ? "s" : ""}` : "No source PDF"}</span>{pdfIndexes.length > 0 && <div className="library-pdf-actions">{pdfIndexes.map((index, ordinal) => item.DriveFileId && ordinal === 0 ? <a key={index} href={`https://drive.google.com/file/d/${encodeURIComponent(item.DriveFileId)}/view`} target="_blank" rel="noreferrer" className="mini-button"><ArrowUpRight size={15} />View {kind === "invoices" ? "invoice" : "statement"}</a> : item.WorkerManaged ? <button key={index} type="button" className="mini-button" onClick={() => void openPdf(item, index)} disabled={!paired || !!opening}><ArrowUpRight size={15} />{opening === `${item.Id}:${index}` ? "Opening…" : `View ${kind === "invoices" ? "invoice" : "statement"}${pdfIndexes.length > 1 ? ` ${ordinal + 1}` : ""}`}</button> : null)}</div>}</div>
        </article>;
      })}
      {!busy && !visible.length && <div className="library-empty"><FileText size={25} /><h2>{exclusionMode ? "No excluded candidates match these filters" : "No documents match these filters"}</h2><p>{items.length ? "Try another person, year or search term." : exclusionMode ? paired ? "Nothing in the current worker index is being excluded from Invoices." : "Connect the worker to review excluded candidates." : paired ? "No indexed documents are available in this section yet." : "Connect the worker to load indexed documents."}</p></div>}
    </div>
  </section>;
}
