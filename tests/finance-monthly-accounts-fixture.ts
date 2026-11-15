import { createHash } from "node:crypto";
import { plaidCurrentNet, validateFinanceAccountCapturesState, type FinanceCaptureAccount, type FinanceAccountCapture } from "../apps/worker/src/finance-account-captures-model.ts";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export function monthlyCapture(month = "2026-11", version = "current"): FinanceAccountCapture {
 const raw = [420000, 680000, 2200000, 1300000, 400000, 125000, 200000, 150000, 50000];
 const kinds: FinanceCaptureAccount["kind"][] = ["depository", "depository", "investment", "investment", "investment", "credit", "loan", "depository", "depository"];
 const names = ["Compte courant fictif A", "Épargne fictive A", "Placements fictifs A", "Retraite fictive A", "Études fictives A", "Carte fictive A", "Marge fictive A", "Compte courant fictif B", "Épargne fictive B"];
 const accounts = raw.map((amountCents, i): FinanceCaptureAccount => {
   const account: FinanceCaptureAccount = { sourceKey: "fsi_" + hash("fictitious-account-" + i), name: names[i], institution: "Banque fictive", kind: kinds[i], provider: "plaid", balance: { amountCents, currency: "CAD", sourceAsOf: null }, credit: null, netBalance: null };
   if(i===5) account.credit={statementBalance:{amountCents:100000,currency:'CAD',sourceAsOf:'2026-10-02'},minimumPayment:{amountCents:3500,currency:'CAD',sourceAsOf:null},paymentDueOn:'2026-11-28'};
   account.netBalance = plaidCurrentNet(account); return account;
 });
 return { id: hash(month + version), origin: "source-capture", snapshot: { schemaVersion: 1, source: "finances-plugin", collectedAt: month + "-15T09:30:00.000Z", coverage: "complete", sourceAccountCount: 9, sourceSha256: hash("fictitious-source-" + version), supersedesCaptureId: null, accounts } };
}
export function monthlyState() {
 const october = monthlyCapture("2026-10", "old"), november = monthlyCapture();
 october.snapshot.accounts[0].balance!.amountCents = 400000; october.snapshot.accounts[0].netBalance = plaidCurrentNet(october.snapshot.accounts[0]);
 const legacy: FinanceAccountCapture = { id: hash("legacy-seven"), origin: "legacy-inventory", snapshot: { ...november.snapshot, collectedAt: "2026-11-15T12:00:00.000Z", coverage: "partial", sourceAccountCount: null, sourceSha256: null, accounts: november.snapshot.accounts.slice(0, 7).map(a => ({ ...a, provider: "unknown", netBalance: null })) } };
 return validateFinanceAccountCapturesState({ revision: hash("fictitious-revision"), captures: [october, november, legacy] }, new Date("2026-12-01T00:00:00Z"));
}

export function monthlyHistory() { const c=monthlyCapture('2026-10','archive'); return { capability:'finance-account-history-v1' as const, unavailableArchiveCount:0,versions:[{id:hash('archive'),sourceSha256:hash('archive-bytes'),sourceAsOf:'2026-10-09',collectedAt:null,convention:'recorded-signed-unverified' as const,sourceAccountCount:9,coverage:'complete-recorded-scope' as const,accounts:c.snapshot.accounts.map((a,i)=>({sourceKey:'fhi_'+hash('archive-'+i),canonicalAccountId:i===2?'rrsp':'synthetic-historical-'+i,name:a.name,kind:a.kind,currency:'CAD',balanceCents:a.netBalance!.amountCents-(i===0?20000:0)}))}]}; }
