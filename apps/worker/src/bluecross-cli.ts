import { initializeInvoices, initializeBlueCrossStatus, syncBlueCrossPortal } from "./invoices.js";
import { blueCrossProfileDirectory, blueCrossSnapshotDirectory } from "./bluecross-collector.js";
import { dataDirectory } from "./private-store.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

async function applyThroughWorker(): Promise<Awaited<ReturnType<typeof syncBlueCrossPortal>>> {
  const port = Number(process.env.FAMILYHUB_WORKER_PORT || 4713);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("The local worker port is invalid.");
  let key: string;
  try { key = (await readFile(join(dataDirectory, "pairing-key.txt"), "utf8")).trim(); }
  catch { throw new Error("Start the updated FamilyHub worker with its existing private DataDirectory before applying."); }
  const base = `http://127.0.0.1:${port}`;
  const headers = { "Content-Type": "application/json", "x-familyhub-key": key };
  const health = await fetch(`${base}/health`, { headers, signal: AbortSignal.timeout(10_000) });
  if (!health.ok) throw new Error("The existing local worker could not be authenticated. Nothing was applied.");
  const info = await health.json() as { version?: string };
  const parts = (info.version || "0").split(".").map(Number);
  if ((parts[0] || 0) < 2 || (parts[0] === 2 && (parts[1] || 0) < 9))
    throw new Error("Update the existing FamilyHub worker to 2.9.0 or later before applying.");
  const response = await fetch(`${base}/bluecross/sync`, {
    method: "POST", headers, body: JSON.stringify({ apply: true }), signal: AbortSignal.timeout(6 * 60_000)
  });
  const result = await response.json() as Awaited<ReturnType<typeof syncBlueCrossPortal>> & { error?: string };
  if (!response.ok) throw new Error(result.error || "The local worker rejected Blue Cross apply. Nothing was applied.");
  return result;
}

const args = process.argv.slice(2);
if (args.some(arg => !["--dry-run", "--apply", "--login"].includes(arg))
  || args.includes("--apply") && (args.includes("--dry-run") || args.includes("--login"))) {
  console.error("Usage: npm run collect:bluecross -- [--dry-run | --apply] [--login]");
  process.exitCode = 2;
} else {
  try {
    // A separate CLI process may never mutate the live index behind the worker's in-memory state.
    if (!args.includes("--apply")) {
      await initializeInvoices(true);
      await initializeBlueCrossStatus();
    }
    const result = args.includes("--apply") ? await applyThroughWorker() : await syncBlueCrossPortal(false, args.includes("--login"));
    if (result.status === "login-required") {
      console.log("Blue Cross login required. Run again with --login on the PC to sign in using the visible browser.");
      process.exitCode = 2;
    } else {
      console.log(`Blue Cross sync ${result.applied ? "apply" : "preview"}`);
      console.log(`Rows found: ${result.found}\nAlready known: ${result.unchanged}\nNew: ${result.new}\nChanged: ${result.changed}\nAmbiguous: ${result.ambiguous}\nDuplicates: ${result.duplicates}\nErrors: ${result.errors}`);
      if (result.warnings.length) console.log(`Warnings: ${result.warnings.join(" ")}`);
      console.log(`Browser profile: ${blueCrossProfileDirectory}\nSnapshots: ${blueCrossSnapshotDirectory}`);
      if (!result.applied) console.log("No FamilyHub invoice data was modified.");
      if (!result.complete) process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Blue Cross sync failed.");
    process.exitCode = 1;
  }
}
