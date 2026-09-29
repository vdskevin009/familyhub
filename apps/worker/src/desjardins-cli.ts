import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { initializeInvoices, initializeDesjardinsStatus, syncDesjardinsPortal } from "./invoices.js";
import { collectDesjardinsPortal, desjardinsProfileDirectory, desjardinsSnapshotDirectory } from "./desjardins-collector.js";
import { dataDirectory } from "./private-store.js";

async function applyThroughWorker(): Promise<Awaited<ReturnType<typeof syncDesjardinsPortal>>> {
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
  if ((parts[0] || 0) < 2 || (parts[0] === 2 && (parts[1] || 0) < 10))
    throw new Error("Update the existing FamilyHub worker to 2.10.0 or later before applying.");
  const response = await fetch(`${base}/desjardins/sync`, {
    method: "POST", headers, body: JSON.stringify({ apply: true }), signal: AbortSignal.timeout(6 * 60_000)
  });
  const result = await response.json() as Awaited<ReturnType<typeof syncDesjardinsPortal>> & { error?: string };
  if (!response.ok) throw new Error(result.error || "The local worker rejected Desjardins apply. Nothing was applied.");
  return result;
}

const args = process.argv.slice(2);
if (args.some(arg => !["--dry-run", "--apply", "--login", "--repeat"].includes(arg))
  || args.includes("--apply") && (args.includes("--dry-run") || args.includes("--login") || args.includes("--repeat"))) {
  console.error("Usage: npm run collect:desjardins -- [--dry-run | --apply] [--login] [--repeat]");
  process.exitCode = 2;
} else {
  try {
    if (!args.includes("--apply")) {
      await initializeInvoices(true);
      await initializeDesjardinsStatus();
    }
    const result = args.includes("--apply") ? await applyThroughWorker()
      : await syncDesjardinsPortal(false, args.includes("--login"),
        interactive => collectDesjardinsPortal(interactive, args.includes("--repeat") ? 2 : 1));
    if (result.status === "login-required") {
      console.log("Desjardins login required. Run again with --login on the PC and complete the visible MFA flow.");
      process.exitCode = 2;
    } else {
      console.log(`Desjardins sync ${result.applied ? "apply" : "preview"}`);
      console.log(`Rows found: ${result.found}\nAlready known: ${result.unchanged}\nNew: ${result.new}\nChanged: ${result.changed}\nAmbiguous: ${result.ambiguous}\nDuplicates: ${result.duplicates}\nErrors: ${result.errors}`);
      if (args.includes("--repeat")) console.log(result.complete ? "Two consecutive portal passes agreed." : "Two-pass verification did not pass.");
      if (result.warnings.length) console.log(`First warnings: ${result.warnings.join(" ")}${result.errors > result.warnings.length ? ` (and ${result.errors - result.warnings.length} more in the private snapshot)` : ""}`);
      console.log(`Browser profile: ${desjardinsProfileDirectory}\nSnapshots: ${desjardinsSnapshotDirectory}`);
      if (!result.applied) console.log("No FamilyHub invoice data was modified. Explicit apply uses this private preview for up to 24 hours.");
      if (!result.complete || result.ambiguous) process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Desjardins sync failed.");
    process.exitCode = 1;
  }
}
