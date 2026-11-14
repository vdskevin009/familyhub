import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { atomicJson } from "./private-store.js";
export type BlueCrossImportIntent = { email: string; messageIds: string[]; apply: boolean };
export type BlueCrossImportJob = { requestId: string; status: "running" | "applying" | "completed" | "failed" | "cancelled" | "outcome-unknown"; result?: unknown; error?: string };
type Receipt = BlueCrossImportJob & { fingerprint: string; apply: boolean };
type State = { schema: 1; jobs: Receipt[] };
type Dependencies = { directory: string; run(intent: BlueCrossImportIntent, options: { signal: AbortSignal; onApplying: () => Promise<void> }): Promise<unknown>; write?: typeof atomicJson };
type ImportResult = { applied: boolean; reports: Array<{ messageId: string; rows: number; pagePaid: number; totalPaid: number | null; warning: string }>; uniqueRows: number; repeatedRows: number; paid: number; newItems: number; recoveredExpenses: number; backup?: string };
function normalizedResult(value: unknown, apply: boolean): ImportResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid import result.");
  const r = value as Record<string, unknown>;
  if (Object.keys(r).some(key => !["applied", "reports", "uniqueRows", "repeatedRows", "paid", "newItems", "recoveredExpenses", "backup"].includes(key)) || r.applied !== apply || !Array.isArray(r.reports) || r.reports.length > 10) throw new Error("Invalid import result.");
  const count = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= 100_000;
  const money = (v: unknown) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 1_000_000_000;
  if (![r.uniqueRows, r.repeatedRows, r.newItems, r.recoveredExpenses].every(count) || !money(r.paid) || r.backup !== undefined && (typeof r.backup !== "string" || !/^invoices\.pre-bluecross-[0-9]+-[a-f0-9-]{36}\.json$/.test(r.backup))) throw new Error("Invalid import result.");
  const reports = r.reports.map(value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid import report.");
    const row = value as Record<string, unknown>;
    if (Object.keys(row).some(key => !["messageId", "rows", "pagePaid", "totalPaid", "warning"].includes(key)) || typeof row.messageId !== "string" || !/^[a-f0-9]{8,40}$/i.test(row.messageId) || !count(row.rows) || !money(row.pagePaid) || row.totalPaid !== null && !money(row.totalPaid) || typeof row.warning !== "string" || row.warning.length > 2000) throw new Error("Invalid import report.");
    return { messageId: row.messageId, rows: row.rows as number, pagePaid: row.pagePaid as number, totalPaid: row.totalPaid as number | null, warning: row.warning };
  });
  return { applied: apply, reports, uniqueRows: r.uniqueRows as number, repeatedRows: r.repeatedRows as number, paid: r.paid as number, newItems: r.newItems as number, recoveredExpenses: r.recoveredExpenses as number, ...(r.backup ? { backup: r.backup as string } : {}) };
}
/** Private durable receipts prevent replay after a lost response or process restart. No source bodies are stored. */
export class BlueCrossImportJobs {
  private state: State = { schema: 1, jobs: [] };
  private ready: Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();
  private active?: { id: string; controller: AbortController };
  private unavailable = false;
  private path: string;
  constructor(private deps: Dependencies) { this.path = join(deps.directory, "bluecross-import-jobs.json"); this.ready = this.load(); }
  private async load() {
    try {
      const raw = await readFile(this.path, "utf8"); if (Buffer.byteLength(raw) > 8_000_000) throw new Error();
      const value = JSON.parse(raw) as State;
      if (!value || typeof value !== "object" || Object.keys(value).some(key => !["schema", "jobs"].includes(key)) || value.schema !== 1 || !Array.isArray(value.jobs) || value.jobs.length > 128) throw new Error();
      for (const job of value.jobs) if (!job || typeof job !== "object" || Object.keys(job).some(key => !["requestId", "status", "result", "error", "fingerprint", "apply"].includes(key)) || typeof job.requestId !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(job.requestId) || typeof job.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(job.fingerprint) || typeof job.apply !== "boolean"
        || !["running", "applying", "completed", "failed", "cancelled", "outcome-unknown"].includes(job.status) || job.error !== undefined && (typeof job.error !== "string" || job.error.length > 500)
        || Buffer.byteLength(JSON.stringify(job)) > 200_000) throw new Error();
      if (new Set(value.jobs.map(j => j.requestId)).size !== value.jobs.length) throw new Error();
      for (const job of value.jobs) { if (job.status === "completed") job.result = normalizedResult(job.result, job.apply); else if (job.result !== undefined) throw new Error(); }
      this.state = value;
      // Never resume an accepted operation automatically, even if it had not reached the visible apply boundary.
      for (const job of this.state.jobs) if (job.status === "running" || job.status === "applying") { job.status = "outcome-unknown"; delete job.result; job.error = "Worker restarted during this request. Inspect the ledger before any new apply; it was not replayed."; }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.unavailable = true; }
  }
  private serialized<T>(action: () => Promise<T>): Promise<T> { const next = this.queue.then(action); this.queue = next.catch(() => {}); return next; }
  private async save() {
    if (this.unavailable) throw new Error("Import receipt state is unavailable. Inspect it before retrying.");
    try { if (Buffer.byteLength(JSON.stringify(this.state)) > 8_000_000) throw new Error(); await (this.deps.write || atomicJson)(this.path, this.state); }
    catch { this.unavailable = true; throw new Error("Import receipt persistence failed. Its outcome must be inspected before retrying."); }
  }
  private output(job: Receipt): BlueCrossImportJob { return structuredClone({ requestId: job.requestId, status: job.status, ...(job.result !== undefined ? { result: job.result } : {}), ...(job.error ? { error: job.error } : {}) }); }
  private validateId(id: string) { if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(id)) throw new Error("A valid unique import request ID is required."); }
  async start(requestId: string, input: BlueCrossImportIntent): Promise<BlueCrossImportJob> {
    this.validateId(requestId); const intent = structuredClone(input);
    if (!intent || typeof intent.email !== "string" || intent.email.length > 320 || !/^[^\s@]+@[^\s@]+$/.test(intent.email) || !Array.isArray(intent.messageIds) || intent.messageIds.length < 1 || intent.messageIds.length > 10
      || intent.messageIds.some(id => typeof id !== "string" || !/^[a-f0-9]{8,40}$/i.test(id)) || new Set(intent.messageIds).size !== intent.messageIds.length || typeof intent.apply !== "boolean") throw new Error("Provide an exact account, unique bounded message IDs and explicit apply flag.");
    intent.email = intent.email.toLowerCase(); const fingerprint = createHash("sha256").update(JSON.stringify(intent)).digest("hex"); await this.ready;
    return this.serialized(async () => {
      if (this.unavailable) throw new Error("Import receipt state is unavailable. Inspect it before retrying.");
      const existing = this.state.jobs.find(j => j.requestId === requestId);
      if (existing) { if (existing.fingerprint !== fingerprint) throw new Error("Import request ID is already bound to different input."); return this.output(existing); }
      if (this.state.jobs.some(j => j.apply && j.status === "outcome-unknown")) throw new Error("A previous apply has an unknown outcome. Reconcile it before starting another import.");
      if (this.active) throw new Error("A Blue Cross import request is already running. Read its status before retrying.");
      if (this.state.jobs.length >= 128) throw new Error("Import receipt capacity reached. Review the private receipt history before adding requests.");
      const job: Receipt = { requestId, fingerprint, apply: intent.apply, status: "running" }; this.state.jobs.push(job); await this.save();
      const active = { id: requestId, controller: new AbortController() }; this.active = active;
      void this.execute(job, intent, active).catch(() => { this.unavailable = true; }); return this.output(job);
    });
  }
  private async execute(job: Receipt, intent: BlueCrossImportIntent, active: { id: string; controller: AbortController }) {
    let applying = false, uncertain = false;
    try {
      const result = await this.deps.run(intent, { signal: active.controller.signal, onApplying: () => this.serialized(async () => {
        active.controller.signal.throwIfAborted(); if (job.status !== "running" || !intent.apply) throw new Error("Import is no longer eligible to apply.");
        job.status = "applying"; await this.save(); applying = true;
      }) });
      active.controller.signal.throwIfAborted(); if (intent.apply && !applying) { uncertain = true; throw new Error("Apply boundary was not verified."); }
      const normalized = normalizedResult(result, intent.apply);
      await this.serialized(async () => { active.controller.signal.throwIfAborted(); if (job.status === "cancelled") throw new Error("Import was cancelled."); job.status = "completed"; job.result = normalized; await this.save(); });
    } catch {
      await this.serialized(async () => {
        if (job.status !== "cancelled") { job.status = applying || uncertain ? "outcome-unknown" : "failed"; job.error = applying || uncertain ? "Apply did not finish cleanly. Inspect the ledger before any retry; this request will not be replayed." : "Import stopped before its apply boundary. This request will not be replayed."; }
        await this.save();
      });
    } finally { if (this.active === active) this.active = undefined; }
  }
  async status(requestId: string): Promise<BlueCrossImportJob> {
    this.validateId(requestId); await this.ready; return this.serialized(async () => { if (this.unavailable) throw new Error("Import receipt state is unavailable. Inspect it before retrying."); const job = this.state.jobs.find(j => j.requestId === requestId); if (!job) throw new Error("Import request is unknown. It was not started or replayed."); return this.output(job); });
  }
  async cancel(requestId: string): Promise<BlueCrossImportJob> {
    this.validateId(requestId); await this.ready; return this.serialized(async () => {
      if (this.unavailable) throw new Error("Import receipt state is unavailable. Inspect it before retrying.");
      const job = this.state.jobs.find(j => j.requestId === requestId); if (!job) throw new Error("Import request is unknown.");
      if (job.status === "applying" || job.status === "outcome-unknown") throw new Error("Application may have started. It cannot be cancelled; inspect the ledger and request status.");
      if (job.status === "running") { job.status = "cancelled"; this.active?.controller.abort(); await this.save(); }
      return this.output(job);
    });
  }
}
