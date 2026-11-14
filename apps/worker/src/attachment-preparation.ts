import { createHash } from "node:crypto";
export class OriginalPreparationRequiredError extends Error { constructor() { super("Prepare this original file before downloading."); } }
export type OriginalFile = { bytes: Buffer; name: string };
export type OriginalTarget = { fingerprint: string; size: number; name: string };
export type OriginalPreparationStatus = { requestId: string; status: "pending" | "ready" | "failed" | "cancelled"; error?: string };
type Work = { invoiceId: string; attachmentId: string; target: OriginalTarget; controller: AbortController; timer: ReturnType<typeof setTimeout>; started: boolean; settled: boolean; status: "pending" | "ready" | "failed"; error?: string; file?: OriginalFile; updated: number };
type Handle = { requestId: string; work: Work; cancelled: boolean; updated: number };
type Dependencies = { resolve(invoiceId: string, attachmentId: string): Promise<OriginalTarget>; load(invoiceId: string, attachmentId: string, signal: AbortSignal): Promise<OriginalFile>; timeoutMs?: number; now?: () => number };
/** Bounded, memory-only read jobs. No portal action, upload, persisted job or automatic retry. */
export class AttachmentPreparations {
  private handles = new Map<string, Handle>();
  private works = new Map<string, Work>();
  private pumping = false;
  private now: () => number;
  constructor(private deps: Dependencies) { this.now = deps.now || Date.now; }
  private key(invoiceId: string, attachmentId: string, target: OriginalTarget) { return createHash("sha256").update(JSON.stringify([invoiceId, attachmentId, target.fingerprint])).digest("hex"); }
  private validateRequest(requestId: string, invoiceId: string, attachmentId: string) {
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(requestId) || !invoiceId || invoiceId.length > 300 || !attachmentId || attachmentId.length > 1500) throw new Error("Invalid original preparation request.");
  }
  private async resolve(invoiceId: string, attachmentId: string) {
    const target = await this.deps.resolve(invoiceId, attachmentId);
    if (!/^[a-f0-9]{64}$/.test(target.fingerprint) || !Number.isSafeInteger(target.size) || target.size < 0 || target.size > 20_000_000 || typeof target.name !== "string" || target.name.length > 255) throw new Error("Original source metadata is invalid.");
    return target;
  }
  private current(handle: Handle, invoiceId: string, attachmentId: string) {
    if (handle.work.invoiceId !== invoiceId || handle.work.attachmentId !== attachmentId) throw new Error("Original request identity changed.");
  }
  private output(handle: Handle): OriginalPreparationStatus {
    return { requestId: handle.requestId, status: handle.cancelled ? "cancelled" : handle.work.status, ...(!handle.cancelled && handle.work.error ? { error: handle.work.error } : {}) };
  }
  private prune() {
    const cutoff = this.now() - 15 * 60_000;
    for (const [id, handle] of this.handles) if (handle.updated < cutoff && (handle.cancelled || handle.work.settled)) this.handles.delete(id);
    for (const [key, work] of this.works) if (work.settled && ![...this.handles.values()].some(h => h.work === work)) { clearTimeout(work.timer); this.works.delete(key); }
  }
  async prepare(requestId: string, invoiceId: string, attachmentId: string): Promise<OriginalPreparationStatus> {
    this.validateRequest(requestId, invoiceId, attachmentId); const target = await this.resolve(invoiceId, attachmentId); this.prune();
    const previous = this.handles.get(requestId);
    if (previous) { this.current(previous, invoiceId, attachmentId); if (previous.work.target.fingerprint !== target.fingerprint) throw new Error("Original source changed; review it before starting a new request."); return this.output(previous); }
    if (this.handles.size >= 32) throw new Error("Too many original preparation requests. Wait for existing requests to expire.");
    const key = this.key(invoiceId, attachmentId, target); let work = this.works.get(key);
    if (work?.controller.signal.aborted && !work.settled) throw new Error("Original cancellation is still finishing. Wait before starting a new request.");
    if (!work || work.status === "failed" && work.settled) {
      if ([...this.works.values()].filter(w => !w.settled).length >= 4) throw new Error("Original preparation queue is full.");
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), this.deps.timeoutMs ?? 12 * 60_000); timer.unref();
      work = { invoiceId, attachmentId, target, controller, timer, started: false, settled: false, status: "pending", updated: this.now() }; this.works.set(key, work);
    }
    const handle = { requestId, work, cancelled: false, updated: this.now() }; this.handles.set(requestId, handle); void this.pump(); return this.output(handle);
  }
  private async pump() {
    if (this.pumping) return; this.pumping = true;
    try {
      for (;;) {
        const work = [...this.works.values()].find(w => !w.started && !w.settled); if (!work) break; work.started = true;
        try {
          work.controller.signal.throwIfAborted();
          if ((await this.resolve(work.invoiceId, work.attachmentId)).fingerprint !== work.target.fingerprint) throw new Error();
          const file = await this.deps.load(work.invoiceId, work.attachmentId, work.controller.signal);
          work.controller.signal.throwIfAborted();
          if ((await this.resolve(work.invoiceId, work.attachmentId)).fingerprint !== work.target.fingerprint || !Buffer.isBuffer(file.bytes) || file.bytes.length !== work.target.size || file.name !== work.target.name) throw new Error();
          // Bound ready byte ownership. Expired requests are removed first; do not discard active callers' files.
          this.prune(); const held = [...this.works.values()].reduce((n,w) => n + (w.file?.bytes.length || 0), 0);
          if (held + file.bytes.length > 64_000_000) throw new Error();
          work.file = { bytes: Buffer.from(file.bytes), name: file.name }; work.status = "ready";
        } catch { work.status = "failed"; work.error = work.controller.signal.aborted ? "Original preparation stopped or expired. No upload or portal action was started." : "Original preparation failed or its source changed. Review the source before trying again."; }
        finally { work.settled = true; work.updated = this.now(); clearTimeout(work.timer); }
      }
    } finally { this.pumping = false; }
  }
  private handle(requestId: string, invoiceId: string, attachmentId: string) {
    this.validateRequest(requestId, invoiceId, attachmentId); this.prune(); const handle = this.handles.get(requestId);
    if (!handle) throw new Error("Original preparation is unavailable or expired. It was not restarted."); this.current(handle, invoiceId, attachmentId); return handle;
  }
  async status(requestId: string, invoiceId: string, attachmentId: string): Promise<OriginalPreparationStatus> {
    const handle = this.handle(requestId, invoiceId, attachmentId); handle.updated = this.now();
    if (!handle.cancelled && (await this.resolve(invoiceId, attachmentId)).fingerprint !== handle.work.target.fingerprint) {
      handle.work.controller.abort(); handle.work.status = "failed"; handle.work.file = undefined; handle.work.error = "Original source changed. Review it before starting a new request.";
    }
    return this.output(handle);
  }
  cancel(requestId: string, invoiceId: string, attachmentId: string): OriginalPreparationStatus {
    const handle = this.handle(requestId, invoiceId, attachmentId); handle.cancelled = true; handle.updated = this.now();
    if (![...this.handles.values()].some(h => h.work === handle.work && !h.cancelled)) handle.work.controller.abort();
    return this.output(handle);
  }
  async read(requestId: string, invoiceId: string, attachmentId: string): Promise<OriginalFile> {
    const status = await this.status(requestId, invoiceId, attachmentId), handle = this.handles.get(requestId)!;
    if (status.status !== "ready" || handle.cancelled || handle.work.status !== "ready" || !handle.work.file) throw new Error("Original preparation is not ready or was cancelled.");
    return { bytes: Buffer.from(handle.work.file.bytes), name: handle.work.file.name };
  }
}