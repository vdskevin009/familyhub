type InvoiceProgress = { error?: string; window?: unknown; invoiceHistoryWindow?: unknown; healthReceiptRepairVersion?: number };
export type DailyResponse = { error?: string; busy?: boolean; setupRequired?: boolean; capabilities?: string[];
  progress?: Record<string, InvoiceProgress>; incomplete?: boolean; lastSuccess?: string; lastAttempt?: string;
  accounts?: Array<{ active?: boolean; error?: string; window?: unknown }> };
export type DailyCall = (path: string, method?: "GET" | "POST") => Promise<DailyResponse>;

/** Existing daily task, two independent outcomes. Never replay an uncertain POST. */
export async function runDailyCollections(call: DailyCall,
  options: { pause?: () => Promise<void>; now?: () => number } = {}): Promise<{ invoices: string; groceries: string }> {
  const pause = options.pause ?? (() => new Promise(resolve => setTimeout(resolve, 5000)));
  const now = options.now ?? Date.now;
  const result = { invoices: "pending", groceries: "pending" };
  try {
    const initial = await call("/invoices");
    if (initial.setupRequired) throw new Error("setup-required");
    if (!initial.busy) await call("/invoices/collect", "POST");
    const deadline = now() + 3 * 60 * 60_000;
    for (;;) {
      await pause();
      const state = await call("/invoices");
      if (now() > deadline) throw new Error("timeout");
      if (!state.busy) {
        if (state.error) {
          const progress = Object.values(state.progress || {});
          if (progress.length && progress.every(item => !item.error)
            && progress.some(item => item.window || item.invoiceHistoryWindow || item.healthReceiptRepairVersion !== 1)) {
            await call("/invoices/collect", "POST"); continue;
          }
          throw new Error("incomplete");
        }
        result.invoices = "complete"; break;
      }
    }
  } catch { result.invoices = "incomplete-or-unknown"; }

  // This phase is attempted even when invoice evidence needs attention. The worker owns concurrency.
  try {
    const phaseStarted = now();
    const health = await call("/health");
    if (!health.capabilities?.includes("grocery-collection-v1")) throw new Error("worker-upgrade-required");
    let state = await call("/groceries/collection-status");
    let previousSuccess = state.lastSuccess;
    if (!state.busy) await call("/groceries/collect", "POST");
    const deadline = now() + 30 * 60_000;
    for (;;) {
      await pause();
      state = await call("/groceries/collection-status");
      if (now() > deadline) throw new Error("timeout");
      if (state.busy) continue;
      if (state.error || state.accounts?.some(account => account.active !== false && account.error)) throw new Error("incomplete");
      if (state.incomplete) {
        // A completed bounded page tranche is known; continue its persisted window, never an uncertain request.
        previousSuccess = state.lastSuccess;
        await call("/groceries/collect", "POST"); continue;
      }
      if (!state.lastSuccess || state.lastSuccess === previousSuccess || !Number.isFinite(Date.parse(state.lastSuccess))
        || Date.parse(state.lastSuccess) < phaseStarted
        || state.lastAttempt && Date.parse(state.lastSuccess) < Date.parse(state.lastAttempt)) throw new Error("unverified");
      result.groceries = "complete"; break;
    }
  } catch { result.groceries = "incomplete-or-unknown"; }
  return result;
}
