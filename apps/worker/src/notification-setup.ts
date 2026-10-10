import { PushConfiguration } from "./notification-push.js";
import { dataDirectory } from "./private-store.js";

const config = new PushConfiguration(dataDirectory);
if (process.argv.slice(2).join(" ") === "--create --operator-approved") {
  await config.createAfterApproval();
  console.log("FamilyHub Web Push configured in the existing user-protected private store. Enroll each device explicitly in Notifications.");
} else if (process.argv.length === 2 || process.argv.slice(2).join(" ") === "--status") {
  console.log(JSON.stringify({ configured: Boolean(await config.read()), protection: "existing Windows user DPAPI or explicit FamilyHub environment", createsKeys: false }));
} else { throw new Error("Use --status, or --create --operator-approved only after explicit approval for this persistent notification identity."); }
