import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { dataDirectory } from "./private-store.js";
import { runDailyCollections, type DailyCall, type DailyResponse } from "./daily-collections.js";

// All mutations go through the running worker, so Task Scheduler cannot race a phone correction or a manual collection.
const base = `http://127.0.0.1:${Number(process.env.FAMILYHUB_WORKER_PORT || 4713)}`;
try {
  const key = (await readFile(join(dataDirectory, "pairing-key.txt"), "utf8")).trim();
  const call: DailyCall = async (path, method = "GET") => {
    const response = await fetch(base + path, { method, headers: { "x-familyhub-key": key }, signal: AbortSignal.timeout(30_000), redirect: "error", cache: "no-store" });
    const data = await response.json() as DailyResponse;
    if (!response.ok) throw new Error(data.error || `Worker returned ${response.status}.`);
    return data;
  };
  const outcomes = await runDailyCollections(call);
  console.log(`FamilyHub daily collection: invoices=${outcomes.invoices}; groceries=${outcomes.groceries}.`);
  if (Object.values(outcomes).some(value => value !== "complete")) {
    console.error("Read the paired collection statuses before retrying. No uncertain request was replayed.");
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Daily collection failed.");
  process.exitCode = 1;
}
