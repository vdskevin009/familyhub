import { initializeInvoices, initializeBlueCrossStatus, syncBlueCrossPortal } from "./invoices.js";
import { blueCrossProfileDirectory, blueCrossSnapshotDirectory } from "./bluecross-collector.js";

const args = process.argv.slice(2);
if (args.some(arg => !["--dry-run", "--apply", "--login"].includes(arg)) || args.includes("--apply") && args.includes("--dry-run")) {
  console.error("Usage: npm run collect:bluecross -- [--dry-run | --apply] [--login]");
  process.exitCode = 2;
} else {
  // Collection must snapshot the portal before any possible ledger mutation.
  await initializeInvoices(true);
  await initializeBlueCrossStatus();
  try {
    const result = await syncBlueCrossPortal(args.includes("--apply"), args.includes("--login"));
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
