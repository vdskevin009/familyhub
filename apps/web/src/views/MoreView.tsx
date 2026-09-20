import { ChangeEvent, FormEvent, useMemo, useState } from "react";
import {
  Archive, Bot, Check, CloudDownload, CloudUpload, KeyRound, Play, Plus,
  RefreshCw, Search, Server, ShieldCheck, Trash2, Wifi, WifiOff
} from "lucide-react";
import type { HubState } from "../state";
import type {
  AdminSettings, FamilyState, PlannerState, ResearchState, ResearchWatch, ReimbursementState,
  SavingsState, SpendingState, WorkerConfig
} from "../types";
import { downloadJson, readJsonFile, uid } from "../storage";
import { runResearchWatch, syncResearchWatch, testWorker } from "../worker";

type Props = { hub: HubState };

type Backup = {
  schemaVersion: 2;
  exportedAt: string;
  family: FamilyState;
  savings: SavingsState;
  reimbursements: ReimbursementState;
  planner: PlannerState;
  spending: SpendingState;
  research: ResearchState;
  admin: AdminSettings;
};

export default function MoreView({ hub }: Props) {
  const [endpoint, setEndpoint] = useState(hub.worker.Endpoint);
  const [apiKey, setApiKey] = useState(hub.worker.ApiKey);
  const [workerStatus, setWorkerStatus] = useState<"idle" | "testing" | "online" | "offline">("idle");
  const [workerMessage, setWorkerMessage] = useState("");
  const [query, setQuery] = useState("");
  const [targetPrice, setTargetPrice] = useState("");
  const [sources, setSources] = useState("Web");
  const [cadence, setCadence] = useState(24);
  const [busyWatch, setBusyWatch] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const workerReady = Boolean(hub.worker.Endpoint.trim() && hub.worker.ApiKey.trim());
  const watches = useMemo(() => [...hub.research.Watches].sort((a, b) =>
    (b.LastResultAt ?? "").localeCompare(a.LastResultAt ?? "") || a.Query.localeCompare(b.Query)
  ), [hub.research.Watches]);

  function saveWorker() {
    const next: WorkerConfig = {
      Endpoint: endpoint.trim().replace(/\/$/, ""),
      ApiKey: apiKey.trim(),
      ConnectedAt: hub.worker.ConnectedAt
    };
    hub.setWorker(next);
    setMessage("Local worker settings saved on this device.");
    setError("");
  }

  async function testConnection() {
    const candidate = { Endpoint: endpoint.trim().replace(/\/$/, ""), ApiKey: apiKey.trim() };
    setWorkerStatus("testing");
    setWorkerMessage("");
    setError("");
    try {
      const result = await testWorker(candidate);
      const next = { ...candidate, ConnectedAt: new Date().toISOString() };
      hub.setWorker(next);
      setEndpoint(next.Endpoint);
      setApiKey(next.ApiKey);
      setWorkerStatus("online");
      setWorkerMessage(`Connected · worker ${result.version} · Codex ${result.codex}`);
    } catch (err) {
      setWorkerStatus("offline");
      setWorkerMessage("");
      setError(err instanceof Error ? err.message : "Could not reach the worker.");
    }
  }

  async function addWatch(event: FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;
    const parsedTarget = targetPrice.trim() ? Number(targetPrice) : null;
    if (parsedTarget !== null && (!Number.isFinite(parsedTarget) || parsedTarget < 0)) {
      setError("Target price must be a positive number.");
      return;
    }
    const watch: ResearchWatch = {
      Id: uid(),
      Query: query.trim(),
      TargetPrice: parsedTarget,
      Sources: sources.trim() || "Web",
      Auto: false,
      CadenceHours: Math.max(1, cadence)
    };
    hub.setResearch(previous => ({ ...previous, Watches: [...previous.Watches, watch] }));
    setQuery("");
    setTargetPrice("");
    setMessage("Research watch saved locally.");
    if (workerReady) {
      try {
        await syncResearchWatch(hub.worker, watch);
        setMessage("Research watch saved and synced to your local worker.");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Watch saved locally, but worker sync failed.");
      }
    }
  }

  async function updateWatch(watch: ResearchWatch) {
    hub.setResearch(previous => ({
      ...previous,
      Watches: previous.Watches.map(item => item.Id === watch.Id ? watch : item)
    }));
    if (workerReady) {
      try { await syncResearchWatch(hub.worker, watch); }
      catch (err) { setError(err instanceof Error ? err.message : "Worker sync failed."); }
    }
  }

  async function runWatch(watch: ResearchWatch) {
    if (!workerReady) {
      setError("Connect the local AI worker before running research.");
      return;
    }
    setBusyWatch(watch.Id);
    setError("");
    setMessage("");
    try {
      await syncResearchWatch(hub.worker, watch);
      const result = await runResearchWatch(hub.worker, watch);
      hub.setResearch(previous => ({
        ...previous,
        Watches: previous.Watches.map(item => item.Id === watch.Id ? {
          ...item,
          LastRunAt: result.completedAt,
          LastResultAt: result.completedAt,
          LastResult: result.result
        } : item)
      }));
      setMessage("Research completed. Treat prices and availability as leads to verify before buying.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Research failed.");
    } finally {
      setBusyWatch("");
    }
  }

  function exportBackup() {
    const backup: Backup = {
      schemaVersion: 2,
      exportedAt: new Date().toISOString(),
      family: hub.family,
      savings: hub.savings,
      reimbursements: hub.reimbursements,
      planner: hub.planner,
      spending: hub.spending,
      research: hub.research,
      admin: hub.admin
    };
    downloadJson(`familyhub-backup-${new Date().toISOString().slice(0, 10)}.json`, backup);
  }

  async function importBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    try {
      const backup = await readJsonFile<Partial<Backup>>(file);
      if (backup.schemaVersion !== 2 || !backup.family || !backup.savings || !backup.planner) {
        throw new Error("That file is not a FamilyHub v2 backup.");
      }
      if (!confirm("Replace this device's FamilyHub data with the selected backup?")) return;
      hub.setFamily(backup.family);
      hub.setSavings(backup.savings);
      if (backup.reimbursements) hub.setReimbursements(backup.reimbursements);
      hub.setPlanner(backup.planner);
      if (backup.spending) hub.setSpending(backup.spending);
      if (backup.research) hub.setResearch(backup.research);
      if (backup.admin) hub.setAdmin(backup.admin);
      setMessage("Backup restored. Worker pairing settings were intentionally not imported.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not restore that backup.");
    }
  }

  return (
    <div className="view-stack">
      <section className="view-hero compact">
        <div>
          <span className="eyebrow">Capabilities & controls</span>
          <h1>Connect what should help.</h1>
          <p>FamilyHub stays useful without AI. The optional local worker lets your own PC handle deeper analysis and research while keeping a clear approval boundary.</p>
        </div>
        <span className="hero-icon"><Bot size={26} /></span>
      </section>
      {error && <div className="banner error">{error}</div>}
      {message && <div className="banner success"><Check size={17} />{message}</div>}
      <section className="two-column">
        <div className="surface">
          <div className="section-heading inline">
            <div><span className="eyebrow">Local AI</span><h2>FamilyHub worker</h2></div>
            <span className={workerStatus === "online" ? "status-dot online" : "status-dot"}>
              {workerStatus === "online" ? <Wifi size={16} /> : <WifiOff size={16} />}
            </span>
          </div>
          <p className="muted">Run the worker on your own computer. FamilyHub sends only the prompt/context needed for the task. The worker uses your locally configured Codex authentication.</p>
          <div className="form-stack">
            <label>Worker endpoint
              <div className="input-with-icon"><Server size={16} /><input value={endpoint} onChange={event => setEndpoint(event.target.value)} placeholder="https://your-private-worker.example" /></div>
            </label>
            <label>Pairing key
              <div className="input-with-icon"><KeyRound size={16} /><input type="password" autoComplete="off" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder="Generated by the local worker" /></div>
            </label>
          </div>
          <div className="row-actions">
            <button className="button secondary" onClick={saveWorker}>Save</button>
            <button className="button" disabled={workerStatus === "testing"} onClick={testConnection}>
              <RefreshCw size={16} className={workerStatus === "testing" ? "spin" : ""} /> {workerStatus === "testing" ? "Testing…" : "Test connection"}
            </button>
          </div>
          {workerMessage && <div className="inline-status success"><Check size={15} />{workerMessage}</div>}
          <div className="security-note">
            <ShieldCheck size={18} />
            <div><strong>Keep the worker private.</strong><span>It binds to localhost by default. For phone access, use a private HTTPS route you control; the pairing key is an extra guard, not a replacement for network security.</span></div>
          </div>
        </div>

        <div className="surface">
          <div className="section-heading inline">
            <div><span className="eyebrow">Document archive</span><h2>Google Drive filing</h2></div>
            <Archive size={20} />
          </div>
          <p className="muted">Inbox documents can be filed under a single FamilyHub root with sensible health, travel, finance and purchase folders. The original email stays the source of truth.</p>
          <label>Drive root folder
            <input value={hub.admin.DriveRootName} onChange={event => hub.setAdmin(previous => ({ ...previous, DriveRootName: event.target.value }))} placeholder="FamilyHub" />
          </label>
          <label className="toggle-row">
            <input type="checkbox" checked={hub.admin.ArchiveEnabled} onChange={event => hub.setAdmin(previous => ({ ...previous, ArchiveEnabled: event.target.checked }))} />
            <span><strong>Enable Drive archive actions</strong><small>FamilyHub still asks before uploading a detected attachment.</small></span>
          </label>
          <div className="folder-preview">
            <code>{(hub.admin.DriveRootName.trim() || "FamilyHub")}/Administrative/Health/Claims/2026</code>
            <code>{(hub.admin.DriveRootName.trim() || "FamilyHub")}/Administrative/Finance/Bills/2026</code>
            <code>{(hub.admin.DriveRootName.trim() || "FamilyHub")}/Administrative/Purchases/2026</code>
          </div>
        </div>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div><span className="eyebrow">Opportunity radar</span><h2>Research watches</h2><p>Save searches you care about and let the local worker re-check them when you ask, or on a cadence while the worker is running.</p></div>
        </div>
        <section className="two-column research-layout">
          <form className="surface form-surface" onSubmit={addWatch}>
            <span className="eyebrow">New watch</span><h2>What should we look for?</h2>
            <label>Search request<input value={query} onChange={event => setQuery(event.target.value)} placeholder="e.g. Used cargo bike in excellent condition" /></label>
            <label>Target price CAD <small>optional</small><input inputMode="decimal" value={targetPrice} onChange={event => setTargetPrice(event.target.value)} placeholder="2500" /></label>
            <label>Sources / constraints<textarea value={sources} onChange={event => setSources(event.target.value)} rows={3} placeholder="Web, local classifieds, nearby stores…" /></label>
            <label>Re-check cadence
              <select value={cadence} onChange={event => setCadence(Number(event.target.value))}>
                <option value={6}>Every 6 hours</option>
                <option value={12}>Every 12 hours</option>
                <option value={24}>Daily</option>
                <option value={72}>Every 3 days</option>
                <option value={168}>Weekly</option>
              </select>
            </label>
            <button className="button"><Plus size={16} /> Save watch</button>
          </form>

          <div className="watch-list">
            {!watches.length && <div className="surface empty-state"><Search size={29} /><strong>No watches yet</strong><span>Create one for a product, service, trip idea, renewal or other opportunity you want to revisit.</span></div>}
            {watches.map(watch => (
              <article className="surface watch-card" key={watch.Id}>
                <div className="watch-top">
                  <div className="grow"><span className="eyebrow">Research watch</span><h3>{watch.Query}</h3></div>
                  <button className="icon-button subtle" aria-label="Delete watch" onClick={() => hub.setResearch(previous => ({
                    ...previous,
                    Watches: previous.Watches.filter(item => item.Id !== watch.Id)
                  }))}><Trash2 size={16} /></button>
                </div>
                <div className="watch-meta">
                  {watch.TargetPrice != null && <span>Target ${watch.TargetPrice.toFixed(0)} CAD</span>}
                  <span>{watch.Sources || "Web"}</span>
                  <span>Every {watch.CadenceHours}h</span>
                </div>
                <label className="toggle-row compact-toggle">
                  <input type="checkbox" checked={watch.Auto} onChange={event => updateWatch({ ...watch, Auto: event.target.checked })} />
                  <span><strong>Automatic re-checks</strong><small>Only while your local worker is running.</small></span>
                </label>
                <div className="row-actions">
                  <button className="button secondary" disabled={!workerReady || busyWatch === watch.Id} onClick={() => runWatch(watch)}>
                    <Play size={15} /> {busyWatch === watch.Id ? "Researching…" : "Run now"}
                  </button>
                  {watch.LastResultAt && <small className="muted">Last run {new Date(watch.LastResultAt).toLocaleString()}</small>}
                </div>
                {watch.LastResult && <div className="research-result">{watch.LastResult}</div>}
              </article>
            ))}
          </div>
        </section>
      </section>

      <section className="surface backup-surface">
        <div>
          <span className="eyebrow">Portable by design</span>
          <h2>Backup this device</h2>
          <p>Export the local FamilyHub state as JSON. Gmail tokens and the worker pairing key are deliberately excluded.</p>
        </div>
        <div className="row-actions">
          <button className="button secondary" onClick={exportBackup}><CloudDownload size={16} /> Export backup</button>
          <label className="button file-button"><CloudUpload size={16} /> Restore backup<input type="file" accept=".json,application/json" onChange={importBackup} /></label>
        </div>
      </section>

      <section className="surface integration-map">
        <div className="section-heading"><span className="eyebrow">One product</span><h2>What lives inside FamilyHub</h2></div>
        <div className="integration-grid">
          <article><span><Bot size={18} /></span><strong>Assistant</strong><small>Today, priorities and local Codex worker</small></article>
          <article><span><Archive size={18} /></span><strong>Life admin</strong><small>Gmail triage and Google Drive filing</small></article>
          <article><span><Search size={18} /></span><strong>Research</strong><small>Opportunity watches handled by your worker</small></article>
          <article><span><Server size={18} /></span><strong>Single repo</strong><small>Web PWA and local worker ship together</small></article>
        </div>
      </section>
    </div>
  );
}
