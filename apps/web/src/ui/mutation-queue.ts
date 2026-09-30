/** Presentation-side serialization only: the server remains the source of truth.
 * Different records can be queued without duplicate requests or parallel writes to
 * the reconciliation graph. A drained batch needs just one authoritative refresh.
 */
export type MutationPhase = "queued" | "saving" | "refreshing" | "checking";
export type MutationProgress = { key: string; phase: MutationPhase; label: string };
type Job = { key: string; label: string; run: () => Promise<void>; resolve: (saved: boolean) => void };
export class MutationQueue {
  private jobs: Job[] = [];
  private pending = new Map<string, MutationProgress>();
  private running = false;
  constructor(private callbacks: {
    change: (pending: MutationProgress[]) => void;
    refresh: () => Promise<void>;
    saved: (count: number) => void;
    error: (message: string) => void;
  }) {}
  get busy() { return this.running; }
  enqueue(key: string, label: string, run: () => Promise<void>): Promise<boolean> {
    if (this.pending.has(key)) return Promise.resolve(false);
    return new Promise(resolve => {
      this.jobs.push({ key, label, run, resolve });
      this.pending.set(key, { key, label, phase: "queued" });
      this.emit();
      void this.drain();
    });
  }
  private emit() { this.callbacks.change([...this.pending.values()]); }
  private async drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.jobs.length) {
        const completed: Job[] = [];
        const failed: Job[] = [];
        while (this.jobs.length) {
          const job = this.jobs.shift()!;
          this.pending.set(job.key, { key: job.key, label: job.label, phase: "saving" }); this.emit();
          try {
            await job.run();
            completed.push(job);
            this.pending.set(job.key, { key: job.key, label: job.label, phase: "refreshing" });
          } catch (error) {
            failed.push(job);
            this.pending.set(job.key, { key: job.key, label: job.label, phase: "checking" });
            this.callbacks.error(error instanceof Error ? error.message : "The change could not be confirmed. Refresh before trying again.");
          }
          this.emit();
        }
        // Refresh even after a failed response: a timed-out request may have saved.
        try {
          await this.callbacks.refresh();
          if (completed.length) this.callbacks.saved(completed.length);
        } catch {
          this.callbacks.error(completed.length
            ? "Saved on the PC, but the latest results could not be loaded. Refresh to see the confirmed state."
            : "Results could not be refreshed. Check the PC connection before trying again.");
        }
        for (const job of failed) { this.pending.delete(job.key); job.resolve(false); }
        for (const job of completed) { this.pending.delete(job.key); job.resolve(true); }
        this.emit();
      }
    } finally { this.running = false; }
  }
}

export function requireSaved(result: { saved: boolean }): void {
  if (result.saved !== true) throw new Error("The PC did not confirm this change. Refresh before trying again.");
}
