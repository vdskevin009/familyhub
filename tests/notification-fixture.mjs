/** Synthetic notification evidence and ephemeral test keys only. Never contact a push provider. */
import { createECDH, randomBytes } from "node:crypto";
import { financeFixture } from "./finance-fixture.mjs";
import { parseFinancePreparation } from "../apps/worker/dist/finance-import.js";
import { newContract } from "../apps/worker/dist/savings-model.js";
export const now = new Date("2026-10-12T17:00:00Z");
export function pushFixture(label = "synthetic") {
  const curve = createECDH("prime256v1"), sender = createECDH("prime256v1"); curve.generateKeys(); sender.generateKeys();
  return { subscription: { endpoint: `https://fcm.googleapis.com/fcm/send/${label}`, keys: { p256dh: curve.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") } }, config: { publicKey: sender.getPublicKey().toString("base64url"), privateKey: sender.getPrivateKey().toString("base64url"), subject: "https://vdskevin009.github.io/familyhub/" } };
}
export function invoiceEvidence() {
  return { setupRequired: false, items: [{ Id: "payment-synthetic", ReimbursedAmount: 80, Currency: "CAD", ReceivedAt: "2026-10-11T12:00:00Z", StatementDate: "2026-10-10", Status: 2, NeedsReview: false }], reconciliations: [{ Id: "claim-synthetic", Currency: "CAD", WorkflowStatus: "open", PotentialRemaining: 20, MatchAssignments: [{ ReimbursementDocumentId: "payment-synthetic", Verification: "confirmed-manually", Confidence: 80 }] }], unmatchedReimbursements: [] };
}
export function financeEvidence() {
  const data = parseFinancePreparation(financeFixture());
  data.collectedOn = "2026-10-12"; data.scope = { from: "2026-01-01", to: "2026-10-12" };
  for (const row of data.transactions) row.date = row.id === "subscription" ? "2026-09-10" : "2026-10-10";
  data.transactions.find(r => r.id === "subscription2").outflowCents = 2500;
  data.gics = [];
  return { schema: 1, revision: "synthetic", data, decisions: {}, imports: [], decisionHistory: [] };
}
export function contractEvidence() { return { ...newContract("telecom", "contract-synthetic"), name: "Synthetic internet", renewal: "2026-10-20", commitmentEnd: "", price: 65, cycle: "monthly", updatedAt: now.toISOString() }; }
