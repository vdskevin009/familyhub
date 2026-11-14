type InvoiceProgress = { error?: string; window?: unknown; invoiceHistoryWindow?: unknown; healthReceiptRepairVersion?: number };
export type DailyResponse = { continuationReady?: boolean; error?: string; busy?: boolean; setupRequired?: boolean; capabilities?: string[];
  progress?: Record<string, InvoiceProgress>; incomplete?: boolean; lastSuccess?: string; lastAttempt?: string;
  accounts?: Array<{ active?: boolean; error?: string; window?: unknown }> };
export type DailyCall = (path: string, method?: "GET" | "POST") => Promise<DailyResponse>;

function hasFreshSuccess(state: DailyResponse, previousSuccess: string | undefined, phaseStarted: number): boolean {
  const success = Date.parse(state.lastSuccess || "");
  const attempt = state.lastAttempt ? Date.parse(state.lastAttempt) : undefined;
  return !!state.lastSuccess && state.lastSuccess !== previousSuccess && Number.isFinite(success)
    && success >= phaseStarted && (attempt === undefined || Number.isFinite(attempt) && success >= attempt);
}

/** Existing daily task, two independent outcomes. Never replay an uncertain POST. */
export async function runDailyCollections(call: DailyCall,
  options: { pause?: () => Promise<void>; now?: () => number } = {}): Promise<{ invoices: string; groceries: string }> {
  const pause = options.pause ?? (() => new Promise(resolve => setTimeout(resolve, 5000)));
  const now = options.now ?? Date.now;
  const result = { invoices: "pending", groceries: "pending" };
  try {
    const phaseStarted = now();
    const initial = await call("/invoices");
    if (initial.setupRequired) throw new Error("setup-required");
    let previousSuccess = initial.lastSuccess;
    let observingInitialBusy = !!initial.busy;
    if (!observingInitialBusy) await call("/invoices/collect", "POST");
    const deadline = now() + 3 * 60 * 60_000;
    for (;;) {
      await pause();
      const state = await call("/invoices");
      if (now() > deadline) throw new Error("timeout");
      if (!state.busy) {
        if (state.setupRequired) throw new Error("setup-required");
        if (observingInitialBusy && !hasFreshSuccess(state, previousSuccess, phaseStarted)) {
          // Busy may belong to a different mail operation. Its completion does not prove this collection ran.
          observingInitialBusy = false;
          previousSuccess = state.lastSuccess;
          await call("/invoices/collect", "POST"); continue;
        }
        observingInitialBusy = false;
        if (state.error) {
          const progress = Object.values(state.progress || {});
          if (state.continuationReady === true || state.continuationReady === undefined && progress.length && progress.every(item => !item.error)
            && progress.some(item => item.window || item.invoiceHistoryWindow)) {
            previousSuccess = state.lastSuccess;
            await call("/invoices/collect", "POST"); continue;
          }
          throw new Error("incomplete");
        }
        if (!hasFreshSuccess(state, previousSuccess, phaseStarted)) throw new Error("unverified");
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
    let observingInitialBusy = !!state.busy;
    if (!observingInitialBusy) await call("/groceries/collect", "POST");
    const deadline = now() + 30 * 60_000;
    for (;;) {
      await pause();
      state = await call("/groceries/collection-status");
      if (now() > deadline) throw new Error("timeout");
      if (state.busy) continue;
      if (observingInitialBusy && !hasFreshSuccess(state, previousSuccess, phaseStarted)) {
        observingInitialBusy = false;
        previousSuccess = state.lastSuccess;
        await call("/groceries/collect", "POST"); continue;
      }
      observingInitialBusy = false;
      if (state.error || state.accounts?.some(account => account.active !== false && account.error)) throw new Error("incomplete");
      if (state.incomplete) {
        // A completed bounded page tranche is known; continue its persisted window, never an uncertain request.
        previousSuccess = state.lastSuccess;
        await call("/groceries/collect", "POST"); continue;
      }
      if (!hasFreshSuccess(state, previousSuccess, phaseStarted)) throw new Error("unverified");
      result.groceries = "complete"; break;
    }
  } catch { result.groceries = "incomplete-or-unknown"; }
  return result;
}
