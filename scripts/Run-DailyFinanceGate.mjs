/** Local guard only. Adapter code is loaded lazily AFTER the preflight gate. */
import {readFile} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {runDailyFinanceGate} from '../apps/worker/src/finance-daily-gate.ts';
if (!process.argv[2] || !process.argv[3]) throw Error('Explicit private directory and reviewed adapter module required.');
const directory = resolve(process.argv[2]), adapterPath = resolve(process.argv[3]);
const scope = JSON.parse(await readFile(join(directory, 'finance-feed/daily-scope.json'), 'utf8'));
let adapterPromise;
function adapter() { return adapterPromise ??= import(pathToFileURL(adapterPath).href); }
const result = await runDailyFinanceGate({directory, scope, callbacks: {
  collect: async attempt => (await adapter()).collect(attempt, {directory, scope}),
  recoverReadOnly: async attempt => (await adapter()).recoverReadOnly(attempt, {directory, scope}),
  verifyReceiptReadOnly: async (receipt, attempt) => (await adapter()).verifyReceiptReadOnly(receipt, attempt, {directory, scope}),
  verifyOutcomeReadOnly: async (report, attempt) => (await adapter()).verifyOutcomeReadOnly(report, attempt, {directory, scope}),
}});
console.log(JSON.stringify(result));
