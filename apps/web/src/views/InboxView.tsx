import { useMemo, useState } from "react";
import {
  Archive, Check, ChevronDown, Download, ExternalLink, FileText, Inbox, Mail, RefreshCw, ShieldCheck, Trash2
} from "lucide-react";
import { currency, dateLabel } from "../domain";
import { googleBridge } from "../google";
import type { HubState } from "../state";
import { ReimbursementCategory, ReimbursementItem, ReimbursementStatus, ScanStats } from "../types";

type Props = { hub: HubState };
type Connection = { email: string; canArchive: boolean };
type Connections = Record<string, Connection | undefined>;
type Filter = "attention" | "all" | "claimed" | "archived" | "ignored";

const slots = ["Kevin", "Jasmine"];

function mergeItems(existing: ReimbursementItem[], incoming: ReimbursementItem[]): ReimbursementItem[] {
  const map = new Map(existing.map(item => [`${item.AccountEmail.toLowerCase()}:${item.SourceMessageId}`, item]));
  for (const next of incoming) {
    const key = `${next.AccountEmail.toLowerCase()}:${next.SourceMessageId}`;
    const current = map.get(key);
    map.set(key, current ? {
      ...next,
      Id: current.Id,
      Status: current.Status,
      Notes: current.Notes,
      DriveFileId: current.DriveFileId,
      DrivePath: current.DrivePath,
      ArchivedAt: current.ArchivedAt
    } : next);
  }
  return [...map.values()];
}

function statusLabel(status: ReimbursementStatus): string {
  switch (status) {
    case ReimbursementStatus.ReadyToClaim: return "Ready to claim";
    case ReimbursementStatus.Claimed: return "Claimed";
    case ReimbursementStatus.Reimbursed: return "Reimbursed";
    case ReimbursementStatus.Ignored: return "Ignored";
    default: return "To review";
  }
}

function categoryLabel(item: ReimbursementItem): string {
  if (item.DocumentType === "bill") return "Bill";
  if (item.DocumentType === "invoice") return "Invoice";
  if (item.DocumentType === "administrative") return "Administrative";
  if (item.DocumentType === "receipt") return "Receipt";
  if (item.DocumentType === "claim") return "Claim";
  if (item.Category === ReimbursementCategory.HealthBenefit) return "Health";
  if (item.Category === ReimbursementCategory.Travel) return "Travel";
  return "Document";
}

export default function InboxView({ hub }: Props) {
  const [connections, setConnections] = useState<Connections>(() => Object.fromEntries(
    slots.map(slot => [slot, googleBridge.connection(slot) ?? undefined])
  ));
  const [months, setMonths] = useState(12);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [stats, setStats] = useState<ScanStats | null>(null);
  const [filter, setFilter] = useState<Filter>("attention");

  const visible = useMemo(() => hub.reimbursements.Items
    .filter(item => {
      if (filter === "attention") return item.Status === ReimbursementStatus.ToReview || item.Status === ReimbursementStatus.ReadyToClaim;
      if (filter === "claimed") return item.Status === ReimbursementStatus.Claimed || item.Status === ReimbursementStatus.Reimbursed;
      if (filter === "archived") return Boolean(item.ArchivedAt);
      if (filter === "ignored") return item.Status === ReimbursementStatus.Ignored;
      return true;
    })
    .sort((a, b) => +new Date(b.ReceivedAt) - +new Date(a.ReceivedAt)), [hub.reimbursements.Items, filter]);

  const attention = hub.reimbursements.Items.filter(item => item.Status === ReimbursementStatus.ToReview || item.Status === ReimbursementStatus.ReadyToClaim);
  const pendingCad = attention.filter(item => item.Currency === "CAD").reduce((sum, item) => sum + (item.DetectedAmount ?? 0), 0);

  async function connect(slot: string) {
    setBusy(`connect-${slot}`);
    setError("");
    try {
      const result = await googleBridge.connect(slot);
      setConnections(previous => ({ ...previous, [slot]: { email: result.email, canArchive: result.canArchive } }));
      setMessage(`Connected ${slot}: ${result.email}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google connection failed.");
    } finally {
      setBusy("");
    }
  }

  function disconnect(slot: string) {
    googleBridge.disconnect(slot);
    setConnections(previous => ({ ...previous, [slot]: undefined }));
    setMessage(`${slot}'s short-lived Google token was cleared.`);
  }

  async function scanSlot(slot: string) {
    if (!connections[slot]) return;
    setBusy(`scan-${slot}`);
    setError("");
    setMessage("");
    try {
      const result = await googleBridge.scan(slot, months);
      hub.setReimbursements(previous => ({
        ...previous,
        Items: mergeItems(previous.Items, result.items)
      }));
      setStats(result.stats);
      setMessage(`Scanned ${result.stats.scanned} candidate emails from ${slot}; kept ${result.stats.kept} and filtered ${result.stats.filteredNoise} likely promotions/newsletters.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Inbox scan failed.");
    } finally {
      setBusy("");
    }
  }

  async function scanAll() {
    const connectedSlots = slots.filter(slot => connections[slot]);
    if (!connectedSlots.length) return;
    setBusy("scan-all");
    setError("");
    setMessage("");
    const aggregate: ScanStats = { scanned: 0, kept: 0, filteredNoise: 0, noDocumentSignal: 0 };
    try {
      for (const slot of connectedSlots) {
        const result = await googleBridge.scan(slot, months);
        hub.setReimbursements(previous => ({ ...previous, Items: mergeItems(previous.Items, result.items) }));
        aggregate.scanned += result.stats.scanned;
        aggregate.kept += result.stats.kept;
        aggregate.filteredNoise += result.stats.filteredNoise;
        aggregate.noDocumentSignal += result.stats.noDocumentSignal;
      }
      setStats(aggregate);
      setMessage(`Scan complete: ${aggregate.kept} useful document candidates kept; ${aggregate.filteredNoise} likely promotions/newsletters filtered.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Inbox scan failed.");
    } finally {
      setBusy("");
    }
  }

  function updateItem(id: string, patch: Partial<ReimbursementItem>) {
    hub.setReimbursements(previous => ({
      ...previous,
      Items: previous.Items.map(item => item.Id === id ? { ...item, ...patch } : item)
    }));
  }

  async function archive(item: ReimbursementItem) {
    setBusy(`archive-${item.Id}`);
    setError("");
    try {
      const archived = await googleBridge.archiveFirstAttachment(item, hub.admin.DriveRootName);
      updateItem(item.Id, { DriveFileId: archived.fileId, DrivePath: archived.path, ArchivedAt: new Date().toISOString() });
      setMessage(`Archived ${item.Attachments[0]?.FileName || "document"} to ${archived.path}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Drive archive failed.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="view-stack">
      <section className="view-hero compact">
        <div>
          <span className="eyebrow">Life admin</span>
          <h1>Inbox that filters itself.</h1>
          <p>Scan only likely bills, receipts, claims and administrative documents. Promotions and bulk mail are scored down before they reach your queue.</p>
        </div>
        <span className="hero-icon"><Inbox size={26} /></span>
      </section>

      {error && <div className="banner error">{error}</div>}
      {message && <div className="banner success"><Check size={17} />{message}</div>}

      <section className="metric-row">
        <article><small>Needs attention</small><strong>{attention.length}</strong><span>documents</span></article>
        <article><small>Detected pending</small><strong>{currency.format(pendingCad)}</strong><span>CAD · review amounts</span></article>
        <article><small>Archived</small><strong>{hub.reimbursements.Items.filter(item => item.ArchivedAt).length}</strong><span>to Drive</span></article>
      </section>

      <section className="surface">
        <div className="section-heading inline">
          <div><span className="eyebrow">Connections</span><h2>Google accounts</h2></div>
          <div className="scan-window">
            <label>Look back
              <select value={months} onChange={event => setMonths(Number(event.target.value))}>
                {[3, 6, 12, 18, 24].map(value => <option key={value} value={value}>{value} months</option>)}
              </select>
            </label>
            <button className="button compact-button" disabled={!Object.values(connections).some(Boolean) || Boolean(busy)} onClick={scanAll}>
              <RefreshCw size={16} className={busy === "scan-all" ? "spin" : ""} /> Scan connected
            </button>
          </div>
        </div>

        <div className="account-row">
          {slots.map(slot => {
            const account = connections[slot];
            return (
              <article className="account-pill" key={slot}>
                <span className="account-avatar">{slot[0]}</span>
                <div className="grow">
                  <strong>{slot}</strong>
                  <small>{account ? account.email : "Not connected"}</small>
                </div>
                {account ? (
                  <>
                    <button className="mini-button" disabled={Boolean(busy)} onClick={() => scanSlot(slot)}>
                      {busy === `scan-${slot}` ? "Scanning…" : "Scan"}
                    </button>
                    <button className="icon-button subtle" aria-label={`Disconnect ${slot}`} onClick={() => disconnect(slot)}><Trash2 size={16} /></button>
                  </>
                ) : (
                  <button className="mini-button primary" disabled={Boolean(busy)} onClick={() => connect(slot)}>
                    {busy === `connect-${slot}` ? "Connecting…" : "Connect"}
                  </button>
                )}
              </article>
            );
          })}
        </div>

        <p className="privacy-note"><ShieldCheck size={15} /> Gmail is read-only. Tokens stay in memory. Drive uses <code>drive.file</code> so FamilyHub can create and manage only its own archive files/folders.</p>
        {stats && (
          <div className="scan-report">
            <span><strong>{stats.scanned}</strong> checked</span>
            <span><strong>{stats.kept}</strong> kept</span>
            <span><strong>{stats.filteredNoise}</strong> ads/bulk filtered</span>
            <span><strong>{stats.noDocumentSignal}</strong> weak signals skipped</span>
          </div>
        )}
      </section>

      <section className="section-block">
        <div className="filter-tabs">
          {([
            ["attention", "Attention"],
            ["all", "All"],
            ["archived", "Archived"],
            ["claimed", "Claimed"],
            ["ignored", "Ignored"]
          ] as Array<[Filter, string]>).map(([id, label]) => (
            <button key={id} className={filter === id ? "active" : ""} onClick={() => setFilter(id)}>{label}</button>
          ))}
        </div>

        <div className="inbox-list">
          {!visible.length && <div className="empty-state"><Mail size={30} /><strong>Nothing here</strong><span>Connect an account and scan, or choose another filter.</span></div>}
          {visible.map(item => (
            <article className="inbox-card" key={item.Id}>
              <div className="inbox-leading"><FileText size={19} /></div>
              <div className="inbox-content">
                <div className="inbox-meta">
                  <span className="chip">{categoryLabel(item)}</span>
                  <span className="chip muted-chip">{item.AccountLabel}</span>
                  <span>{item.Confidence}% match</span>
                  <span>·</span>
                  <span>{dateLabel(item.ReceivedAt)}</span>
                </div>
                <div className="inbox-title-row">
                  <div>
                    <h3>{item.Provider || "Unknown provider"}</h3>
                    <p>{item.Subject || "No subject"}</p>
                  </div>
                  <div className="document-amount">
                    <strong>{item.DetectedAmount != null ? (item.Currency ? `${item.Currency} ${item.DetectedAmount.toFixed(2)}` : item.DetectedAmount.toFixed(2)) : "—"}</strong>
                    <small>{item.DetectedAmount != null ? "detected" : "no amount"}</small>
                  </div>
                </div>
                {!!item.Reasons?.length && <div className="reason-row">{item.Reasons.slice(0, 3).map(reason => <span key={reason}>{reason}</span>)}</div>}
                {item.ArchivedAt && <div className="archive-path"><Archive size={14} />{item.DrivePath}</div>}
                <div className="inbox-actions">
                  <label className="select-wrap">Status
                    <select value={item.Status} onChange={event => updateItem(item.Id, { Status: Number(event.target.value) as ReimbursementStatus })}>
                      {Object.values(ReimbursementStatus).filter(value => typeof value === "number").map(value => (
                        <option key={value} value={value}>{statusLabel(value as ReimbursementStatus)}</option>
                      ))}
                    </select>
                    <ChevronDown size={14} />
                  </label>
                  <button className="mini-button" onClick={() => googleBridge.openMessage(item.AccountEmail, item.InternetMessageId, item.SourceMessageId)}>
                    <ExternalLink size={15} /> Email
                  </button>
                  {item.Attachments[0] && (
                    <>
                      <button className="mini-button" disabled={!connections[item.AccountLabel]} onClick={() => googleBridge.downloadAttachment(
                        item.AccountLabel, item.SourceMessageId, item.Attachments[0].Id, item.Attachments[0].FileName, item.Attachments[0].MimeType
                      )}>
                        <Download size={15} /> Download
                      </button>
                      <button className="mini-button primary" disabled={!connections[item.AccountLabel] || Boolean(busy)} onClick={() => archive(item)}>
                        <Archive size={15} /> {busy === `archive-${item.Id}` ? "Archiving…" : item.ArchivedAt ? "Archive again" : "Archive to Drive"}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
