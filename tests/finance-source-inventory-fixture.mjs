// Fictional data only. Never load private financial source files in tests.
import { financeSourceKey } from '../apps/worker/src/finance-source-inventory-store.ts';
export const inventoryNow = new Date('2030-05-01T12:00:00.000Z');
export function inventoryFixture() {
  const account = financeSourceKey('account', 'fictional-item', 'fictional-card');
  const unavailable = () => ({ status: 'unavailable', coverage: 'unknown', observedCount: 0 });
  return {
    schemaVersion: 1, source: 'finances-plugin', collectedAt: inventoryNow.toISOString(),
    accounts: [{ sourceKey: account, name: 'Carte fictive', institution: 'Banque de démonstration', kind: 'credit', reconciliation: 'not-reconciled',
      balance: { amountCents: -12345, currency: 'CAD', sourceAsOf: null },
      credit: { statementBalance: { amountCents: 9100, currency: 'CAD', sourceAsOf: '2030-04-18' }, minimumPayment: { amountCents: 1500, currency: 'CAD', sourceAsOf: '2030-04-19' }, paymentDueOn: '2030-05-09' } }],
    predictions: [{ sourceKey: financeSourceKey('prediction', 'fictional-item', 'fictional-stream'), accountSourceKey: account, name: 'Abonnement fictif', flow: 'outflow', amount: { amountCents: 1199, currency: 'CAD' }, predictedOn: '2030-04-28', frequency: 'monthly', kind: 'forecast' }],
    availability: { accounts: { status: 'partial', coverage: 'partial', observedCount: 1 }, holdings: unavailable(), activity: unavailable(), recurring: { status: 'partial', coverage: 'partial', observedCount: 1 }, liabilities: { status: 'partial', coverage: 'partial', observedCount: 1 }, budgets: 'not-provided', goals: 'not-provided' },
  };
}
