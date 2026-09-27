import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { dataDirectory } from "./private-store.js";

// All mutations go through the running worker, so Task Scheduler cannot race a phone correction or a manual collection.
const base = `http://127.0.0.1:${Number(process.env.FAMILYHUB_WORKER_PORT || 4713)}`;
try {
  const key = (await readFile(join(dataDirectory, "pairing-key.txt"), "utf8")).trim();
  const call = async (path: string, method = "GET") => {
    const response = await fetch(base + path, { method, headers: { "x-familyhub-key": key }, signal: AbortSignal.timeout(30_000) });
    const data = await response.json() as { error?: string; busy?: boolean; setupRequired?: boolean;
      progress?: Record<string, { error?: string; window?: unknown; invoiceHistoryWindow?: unknown; healthReceiptRepairVersion?: number }> };
    if (!response.ok) throw new Error(data.error || `Worker returned ${response.status}.`);
    return data;
  };
  const initial = await call("/invoices");
  if (initial.setupRequired) throw new Error("Gmail setup is required on this PC.");
  if (!initial.busy) await call("/invoices/collect", "POST");
  const deadline = Date.now() + 3 * 60 * 60_000;
  for (;;) {
    await new Promise(resolve => setTimeout(resolve, 5000));
    const state = await call("/invoices");
    if (Date.now() > deadline) throw new Error("Collection is still running. Inspect FamilyHub before retrying.");
    if (!state.busy) {
      if (state.error) {
        const progress = Object.values(state.progress || {});
        // Continue bounded pages sequentially; never retry an account error automatically.
        if (progress.length && progress.every(item => !item.error)
          && progress.some(item => item.window || item.invoiceHistoryWindow || item.healthReceiptRepairVersion !== 1)) {
          await call("/invoices/collect", "POST"); continue;
        }
        throw new Error("Daily collection is incomplete. Check the local account status in FamilyHub.");
      }
      break;
    }
  }
  console.log("FamilyHub daily collection completed.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Daily collection failed.");
  process.exitCode = 1;
}
