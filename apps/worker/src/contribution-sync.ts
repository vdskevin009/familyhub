import { createHash } from 'node:crypto';
import type { FinanceState } from './finance-model.js';
import { prepareFinancesPluginImport, pluginTransactionKey, type PluginImportPlan, type PluginPage } from './finances-plugin-import.js';
import { ContributionReportStore } from './contribution-report-store.js';
import type { ContributionPlan } from './contribution-progress.js';
export type FinanceTransport = {
  read(): Promise<FinanceState>;
  preview(bundle: unknown): Promise<{possibleDuplicates?: number; revision?: string; alreadyImported?: boolean}>;
  apply(bundle: unknown, expectedRevision: string): Promise<unknown>;
};
/** Reuses the authoritative paired API. Never bypass its queue with a direct ledger write.
 * An uncertain apply is inspected read-only, never replayed within this run.
 */
export async function syncContributionEvidence(input: {
  pages: PluginPage[]; mapping: Omit<PluginImportPlan,'expectedRevision'>;
  contributionPlan: ContributionPlan; reportStore: ContributionReportStore; transport: FinanceTransport;
}) {
  const before=await input.transport.read();
  const {bundle,unassigned}=prepareFinancesPluginImport(input.pages,{...input.mapping,expectedRevision:before.revision},before);
  const digest=createHash('sha256').update(JSON.stringify(bundle)).digest('hex');
  const preview=await input.transport.preview(bundle);
  if ((preview.possibleDuplicates ?? 0)!==0 || (!preview.alreadyImported && preview.revision!==before.revision)) throw new Error('Finance preview changed or requires duplicate review.');
  let uncertain=false;
  if(!preview.alreadyImported) {
    try { await input.transport.apply(bundle,before.revision); }
    catch { uncertain=true; }
  }
  const after=await input.transport.read();
  if(!after.imports.some(i=>i.hash===digest)) throw new Error(uncertain?'Import outcome remains unconfirmed; no automatic replay.':'Finance import readback was not confirmed.');
  for(const incoming of bundle.bankActivities) {
    const saved=after.data?.transactions.find(r=>r.id===incoming.id);
    if(!saved || saved.accountId!==incoming.accountId || saved.date!==incoming.transactionDate || saved.currency!==incoming.currency || saved.outflowCents!==incoming.signedOutflowCents || saved.description!==incoming.descriptionOriginal) throw new Error('Finance source readback mismatch.');
  }
  const reportPlan={...input.contributionPlan,unassignedSourceObservations:unassigned.map(r=>({id:'finances:'+pluginTransactionKey(r),date:r.date,amountCents:Math.round(r.amount*100),currency:r.iso_currency_code}))};
  const report=await input.reportStore.save(after,reportPlan,input.mapping.retrievedAt.slice(0,10));
  return {importConfirmed:true, recoveredUncertainApply:uncertain, importedEvidenceHash:digest, reportId:report.id, reportReplayed:report.replayed};
}