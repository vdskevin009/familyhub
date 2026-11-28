import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Building2, ChevronLeft, ChevronRight, CreditCard, SlidersHorizontal } from "lucide-react";
import { shiftMonth } from "../finance-trends";
import { displayMonthlyCapture, historicalAccountVersions, sourceAccountVersions, selectAccountVersion, summarizeMonthlyAccounts, type MonthlyAccountSelection, type MonthlyAccountRow } from "../finance-monthly-accounts";
import type { AccountHistoryRead } from "../use-finance-account-history";
import type { AccountCaptureRead } from "../use-finance-account-captures";
import InfoPopover, { CompactDialog } from "../ui/InfoPopover";
import "../finance-monthly-accounts.css";
const money = (value: number | null, currency: string) => value === null ? "Not established" : new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(value / 100);
const dateLabel = (date: string) => new Date(date.length === 10 ? date + "T12:00:00Z" : date).toLocaleDateString("en-CA", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const monthLabel = (month: string) => new Date(month + "-15T12:00:00Z").toLocaleDateString("en-CA", { month: "long", year: "numeric", timeZone: "UTC" });
const kindLabels: Record<string, string> = { depository: "Bank account", bank: "Bank account", credit: "Credit card", "credit-card": "Credit card", investment: "Investment", brokerage: "Investment", loan: "Loan", gic: "GIC", other: "Other account", unknown: "Type not provided" };
export default function FinanceMonthlyAccounts({ read, history, selection, onSelection, onOpenHistorical, historicalAccountIds, legacy }: {
  read: AccountCaptureRead; history: AccountHistoryRead; selection: MonthlyAccountSelection;
  onSelection: (value: MonthlyAccountSelection) => void; onOpenHistorical: (id: string) => void; historicalAccountIds: string[]; legacy: ReactNode;
}) {
  const versions = useMemo(() => [...historicalAccountVersions(history.versions), ...sourceAccountVersions(read.captures)], [history.versions, read.captures]);
  const resolved = selectAccountVersion(versions, selection);
  const version = selection.month === null && read.status === "loading" || selection.month === null && read.status === "error" ? undefined : resolved.version;
  const month = selection.month ?? (read.status === "loading" || read.status === "error" ? "" : resolved.month);
  const [filters, setFilters] = useState(false), filterAnchor = useRef<HTMLButtonElement>(null), filterId = useId();
  const [detail, setDetail] = useState<MonthlyAccountRow | null>(null), detailAnchor = useRef<HTMLButtonElement>(null), detailId = useId();
  const currencies = [...new Set(version?.rows.map(r => r.currency).filter((c): c is string => c !== null) ?? [])].sort();
  const summary = version ? summarizeMonthlyAccounts(version, selection.accountId, selection.currency) : null;
  const balanceScale = Math.max(1, summary?.assetsCents ?? 0, summary?.debtsCents ?? 0);
  useEffect(() => {
    if (selection.month !== null || !resolved.version || !["ready", "unsupported"].includes(read.status)) return;
    const available = [...new Set(resolved.version.rows.map(r => r.currency).filter((c): c is string => c !== null))].sort();
    onSelection({ ...selection, month: resolved.month, currency: available.includes(selection.currency) ? selection.currency : available[0] ?? "CAD" });
  }, [selection, resolved.month, resolved.version, read.status, onSelection]);
  // A re-read or changed selected version invalidates the currently open account detail.
  useEffect(() => { setDetail(null); }, [read.status, version?.id, selection.currency, selection.accountId]);
  const chooseMonth = (value: string) => onSelection({ ...selection, month: value, versionId: null, accountId: "" });
  const scopeName = selection.accountId ? version?.rows.find(r => r.id === selection.accountId)?.name ?? "Account unavailable" : "All accounts";
  const stamp = version ? version.dateKind === "received" ? `Received on ${displayMonthlyCapture(version.date)}` : `Values from ${dateLabel(version.date)}` : "";
  const openRow = (row: MonthlyAccountRow, button: HTMLButtonElement) => {
    if (row.canonicalAccountId && historicalAccountIds.includes(row.canonicalAccountId)) { onOpenHistorical(row.canonicalAccountId); return; }
    detailAnchor.current = button; setDetail(row);
  };
  return <div className="finance-monthly-accounts view-stack">
    <div><div className="accounts-period-row"><div className="accounts-month-switcher">
      <button type="button" className="icon-button" aria-label="Previous month" disabled={!month || !resolved.firstMonth || month <= resolved.firstMonth || read.status === "loading"} onClick={() => chooseMonth(shiftMonth(month, -1))}><ChevronLeft size={19} aria-hidden="true" /></button>
      <strong aria-live="polite">{month ? monthLabel(month) : "Accounts"}</strong>
      <button type="button" className="icon-button" aria-label="Next month" disabled={!month || !resolved.lastMonth || month >= resolved.lastMonth || read.status === "loading"} onClick={() => chooseMonth(shiftMonth(month, 1))}><ChevronRight size={19} aria-hidden="true" /></button>
    </div><button type="button" className="button secondary accounts-filter-button" ref={filterAnchor} aria-haspopup="dialog" aria-controls={filterId} aria-expanded={filters} onClick={() => setFilters(true)}><SlidersHorizontal size={17} aria-hidden="true" />Filters</button></div><small className="accounts-scope">{scopeName} · {selection.currency}</small></div>
    {read.status === "loading" && <p className="accounts-status" role="status">Loading account versions…</p>}
    {read.status === "error" && <p className="accounts-status" role="status">Recent versions are unavailable. Refresh to reload from your PC.</p>}
    {read.status === "unsupported" && <p className="accounts-status" role="status">Update the PC to see newer versions. The history is still available.</p>}
    {history.status === "error" && <p className="accounts-status" role="status">Archived history unavailable. Older values are not reconstructed.</p>}
    {version && summary ? <>
      <section className="surface accounts-summary" aria-label={version.dateKind === "source" ? "Total recorded account balance" : "Net account balance"}>
        <div className="accounts-total-heading"><span>{version.dateKind === "source" ? "Recorded total" : summary.complete ? "Net balance" : "Confirmed subtotal"} · {version.origin === "legacy-inventory" ? "partial inventory" : version.dateKind === "received" ? "received version" : "history"}</span><InfoPopover title="Account balances and dates">
          <p>{stamp}.</p><p>{version.dateKind === "source" ? "Sum of the recorded signed values, without reversing credits again. The historical sign convention is not verified." : "Assets minus debts, based on verified net balances for this version and currency only."} This total is neither your complete net worth nor your available cash.</p>
          <p>{summary.includedCount} account(s) included, {summary.unknownCount} value(s) or currency amounts not established for this filter. Coverage: {version.coverage === "complete" ? "complete for this collection" : version.coverage === "partial" ? "partial" : "unknown"}.</p>
          <p>Each account retains its own bank date. Receiving data does not prove the bank has updated it. Balances without a verified net amount are not included. Details about debts or investments may be missing even when their balance is known.</p>
          <p>Earlier versions are not added to this one. Accounts are not matched by name or suffix, and differences are not calculated across unverified scopes.</p>
          {version.notes.map(note => <p key={note}>{note}</p>)}{history.unavailableArchiveCount > 0 && <p>{history.unavailableArchiveCount} unavailable archive(s) excluded from these versions.</p>}{summary.arithmeticUnavailable && <p>The total cannot be displayed safely.</p>}
          {resolved.inMonth.length > 1 && <label>Version for this month<select aria-label="Version for this month" value={version.id} onChange={e => onSelection({ ...selection, month, versionId: e.target.value, accountId: "" })}>{[...resolved.inMonth].reverse().map(v => <option key={v.id} value={v.id}>{v.dateKind === "received" ? "Received " + displayMonthlyCapture(v.date) : "Values from " + dateLabel(v.date)}{v.superseded ? " · superseded" : v.origin === "legacy-inventory" ? " · partial inventory" : ""}</option>)}</select></label>}
        </InfoPopover></div>
        <p className="accounts-net" data-accounts-net>{money(summary.netCents, selection.currency)} <small>{summary.netCents !== null && selection.currency}</small></p>
        {version.dateKind !== "source" ? <dl className="accounts-balance-comparison" aria-label="Assets and debts for this version">
          {([{ label: "Assets", cents: summary.assetsCents, kind: "assets" }, { label: "Debts", cents: summary.debtsCents, kind: "debts" }] as const).map(item => <div key={item.kind}>
            <dt>{item.label}</dt><dd>{money(summary.includedCount ? item.cents : null, selection.currency)}
              {summary.includedCount > 0 && !summary.arithmeticUnavailable && item.cents !== null && <span className="accounts-balance-track" aria-hidden="true"><span data-balance-kind={item.kind} style={{ width: `${item.cents / balanceScale * 100}%` }} /></span>}
            </dd>
          </div>)}
        </dl> : <p className="accounts-equation">{summary.includedCount} recorded signed balances.</p>}
        {summary.unknownCount > 0 && <p className="accounts-equation">{summary.unknownCount} unconfirmed value(s) excluded from the total.</p>}
      </section>
      <p className="accounts-received"><time dateTime={version.date}>{stamp}</time></p>
      <div className="accounts-list-heading"><h2>{summary.rows.length} account{summary.rows.length === 1 ? "" : "s"}</h2><small>{version.dateKind === "source" ? "History" : "Received version"}</small></div>
      <div className="accounts-month-list">{summary.rows.map(row => <button type="button" key={row.id} className="accounts-month-row" data-account-row={row.id} data-investment-account={row.canonicalAccountId} data-liability={version.dateKind !== "source" && row.netCents !== null && row.netCents < 0} onClick={event => openRow(row, event.currentTarget)}>
        <span className="accounts-row-title"><span className="accounts-row-icon">{["credit", "credit-card", "loan"].includes(row.kind) ? <CreditCard size={19} aria-hidden="true" /> : <Building2 size={19} aria-hidden="true" />}</span><span><strong>{row.name}</strong><small>{kindLabels[row.kind] ?? "Type not provided"}{version.dateKind !== "source" && row.netCents !== null && row.netCents < 0 ? " · debt" : ""}</small></span></span>
        <span className="accounts-row-money">{row.currency ? money(row.netCents ?? row.rawCents, row.currency) : "Missing value"}<small>{row.currency ?? "Unknown currency"}{row.netCents === null && row.rawCents !== null ? " · raw, excluded from total" : ""}</small></span>
      </button>)}</div>
      {summary.rows.length === 0 && <p className="accounts-status">There are no accounts in this version that match this filter. No amounts are assumed to be zero.</p>}
    </> : read.status !== "loading" && <p className="accounts-status">{month ? "No version available for this month or selection." : "No recorded account versions."}</p>}
    <CompactDialog id={filterId} title="Account filters" open={filters} onClose={() => setFilters(false)} anchor={filterAnchor}><div className="accounts-filter-content">
      <label>Month<input type="month" aria-label="Account month" value={month} onChange={e => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value)) chooseMonth(e.target.value); }} /></label>
      <label>Account<select aria-label="Account for balances" value={selection.accountId} onChange={e => onSelection({ ...selection, accountId: e.target.value })}><option value="">All accounts</option>{version?.rows.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}{selection.accountId && !version?.rows.some(r => r.id === selection.accountId) && <option value={selection.accountId}>Account unavailable</option>}</select></label>
      <label>Currency<select aria-label="Balance currency" value={selection.currency} onChange={e => onSelection({ ...selection, currency: e.target.value })}>{[...new Set([selection.currency, ...currencies])].sort().map(c => <option key={c}>{c}</option>)}</select></label>
      <button type="button" className="button" onClick={() => setFilters(false)}>View results</button>
    </div></CompactDialog>
    <CompactDialog id={detailId} title={detail?.name ?? "Account"} open={detail !== null} onClose={() => setDetail(null)} anchor={detailAnchor}>{detail && <>
      <p>{kindLabels[detail.kind] ?? "Type not provided"} · {detail.currency ?? "Unknown currency"}</p>
      <p>{version?.dateKind === "source" ? "Recorded value" : "Net balance"} : {detail.currency ? money(detail.netCents, detail.currency) : "Not established"}.</p>
      <p>Raw balance received: {detail.currency ? money(detail.rawCents, detail.currency) : "Not established"}.</p>
      <p>{stamp}.</p><p>{detail.sourceAsOf ? "Bank date: " + dateLabel(detail.sourceAsOf) : "Bank date unknown"}.</p>
      {detail.source?.institution && <p>{detail.source.institution}</p>}
      {detail.source?.credit && <><p>Statement balance: {detail.source.credit.statementBalance ? money(detail.source.credit.statementBalance.amountCents, detail.source.credit.statementBalance.currency) : "Not provided"}. {detail.source.credit.statementBalance?.sourceAsOf ? "Bank date: " + dateLabel(detail.source.credit.statementBalance.sourceAsOf) : "Bank date not provided"}.</p><p>Minimum payment: {detail.source.credit.minimumPayment ? money(detail.source.credit.minimumPayment.amountCents, detail.source.credit.minimumPayment.currency) : "Not provided"}. {detail.source.credit.minimumPayment?.sourceAsOf ? "Bank date: " + dateLabel(detail.source.credit.minimumPayment.sourceAsOf) : "Bank date not provided"}. Payment due: {detail.source.credit.paymentDueOn ?? "Not provided"}.</p></>}
      <p>This balance alone does not establish holdings or individual transactions. No match with the historical register is assumed.</p>
    </>}</CompactDialog>
    <details className="accounts-legacy-disclosure" open={read.status === "unsupported" && history.status === "unsupported" || undefined}><summary className="accounts-history-link">More details and historical register</summary>{legacy}</details>
  </div>;
}
