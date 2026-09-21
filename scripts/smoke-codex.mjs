// Explicit, synthetic-only diagnostic; never sends real Gmail data.
import { classify } from '../apps/worker/dist/invoices.js';
const result = await classify({ id: 'synthetic', threadId: 'synthetic', internetMessageId: '', subject: 'Receipt #TEST123',
  sender: 'Example Clinic <billing@example.test>', receivedAt: new Date().toISOString(),
  text: 'SYNTHETIC TEST DATA. Physiotherapy receipt #TEST123. Total paid CAD 150.00. Service completed. No insurance coverage information is supplied.',
  labels: [], unsubscribe: false, bulk: false, attachments: [] }, 'synthetic@example.test', true);
console.log(JSON.stringify({ source: result.source, kind: result.result.kind, confidence: result.result.confidence, amount: result.result.amount, currency: result.result.currency }));
if (result.source !== 'codex' || result.result.amount !== 150 || result.result.currency !== 'CAD' || result.result.kind !== 'receipt') process.exitCode = 1;
