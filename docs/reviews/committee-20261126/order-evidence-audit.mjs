import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep, basename } from 'node:path';
import { GroceryStore, validateSource } from '../../../apps/worker/dist/grocery-store.js';
import { emptyReceipt, blankItem } from '../../../apps/worker/dist/grocery-model.js';
import { pcExpressMonthlySpending } from '../../../apps/web/src/grocery-monthly-spending.ts';

const output=resolve('output/playwright/committee-20261126');
const directory=await mkdtemp(join(tmpdir(),'fh-committee-orders-'));
const source=text=>validateSource({name:'Synthetic order evidence.txt',type:'text/plain',data:Buffer.from(text).toString('base64')});
const receipt=(reference,total,type='confirmation')=>({...emptyReceipt(),store:'PC Express',sourceType:type,reference,total,date:'2026-11-20',currency:'CAD',items:[{...blankItem(),name:'Fictitious item',product:'Fictitious item',quantity:1,amount:type==='final-receipt'?total:null,evidence:'Synthetic source only'}]});
const order='900000000000026';
const pair=[{accountId:'fixture@example.invalid',messageId:'a000000000000026',receivedAt:'2026-11-20T18:00:00.000Z',orderId:order,kind:'confirmation',receipt:receipt(order,100),source:source('Synthetic original estimate 100 CAD')},{accountId:'fixture@example.invalid',messageId:'b000000000000026',receivedAt:'2026-11-21T18:00:00.000Z',orderId:order,kind:'delivered',source:source('Synthetic delivery; no paid total')}];
const results=[];
try {
 const store=new GroceryStore(join(directory,'automatic'),async()=>{throw new Error('No extractor permitted');});
 const imported=await store.importDeliveredConfirmation(pair), file=join(directory,'automatic','purchases.json');
 const before=await readFile(file), snapshot=(await new GroceryStore(join(directory,'automatic'),async()=>{throw new Error('No extractor');}).list()).records;
 assert.equal(imported.outcome,'imported');assert.equal(snapshot[0].reviewedAt,null);assert.equal(snapshot[0].receipt.sourceType,'confirmation');
 assert.equal(pcExpressMonthlySpending(snapshot).months[0].paid,0);assert.equal(pcExpressMonthlySpending(snapshot).months[0].estimated,100);
 assert.deepEqual(await readFile(file),before);results.push('delivery persists as estimate, restart/readback does not promote payment');
 assert.equal((await store.importDeliveredConfirmation([...pair].reverse())).outcome,'unchanged');assert.deepEqual(await readFile(file),before);results.push('repeated/reordered pair is byte-identical');
 const second={...pair[1],messageId:'c000000000000026',receivedAt:'2026-11-22T18:00:00.000Z',source:source('Synthetic second delivery; no paid total')};
 await assert.rejects(store.importDeliveredConfirmation([...pair,second]));assert.deepEqual(await readFile(file),before);results.push('three-message shipment set rejected without write');
 assert.equal((await store.importDeliveredConfirmation([pair[0],second])).outcome,'conflict');assert.deepEqual(await readFile(file),before);results.push('later distinct delivery does not replace saved source');
 const changed={...pair[0],messageId:'d000000000000026',receipt:receipt(order,80),source:source('Synthetic revised estimate 80 CAD')};
 assert.equal((await store.importDeliveredConfirmation([changed,pair[1]])).outcome,'conflict');assert.deepEqual(await readFile(file),before);results.push('divergent estimate leaves saved bytes intact');
 const manual=new GroceryStore(join(directory,'manual'),async()=>{throw new Error('No extractor');});
 async function save(r,text){const {record}=await manual.import({sources:[source(text)]});return manual.review(record.id,{expectedRevision:record.revision,receipt:r,confirmed:true,save:true,distinctPurchase:true});}
 const a=await save(receipt('900000000000027',60),'Synthetic first confirmation 60 CAD');
 const b=await save(receipt('900000000000027',80),'Synthetic contradictory confirmation 80 CAD');
 const conflictOnly=(await manual.list()).records;assert.equal(pcExpressMonthlySpending(conflictOnly).conflicts,1);assert.equal(pcExpressMonthlySpending(conflictOnly).months.length,0);results.push('contradictory saved estimates remain present but outside amounts');
 await save(receipt('900000000000028',25,'final-receipt'),'Synthetic independently verified final receipt 25 CAD');
 const mixed=(await manual.list()).records;assert.equal(pcExpressMonthlySpending(mixed).months[0].paid,25);assert.equal(pcExpressMonthlySpending(mixed).conflicts,1);results.push('independent final receipt survives unrelated excluded group');
 const unknownOnly=[{...a,receipt:{...a.receipt,date:null,total:null}}];
 const complete=[mixed.find(r=>r.receipt.sourceType==='final-receipt')];
 const oldConflict=mixed.map(r=>r.receipt.sourceType==='confirmation'?{...r,receipt:{...r.receipt,date:'2025-11-20'}}:r);
 await writeFile(join(output,'browser-fixtures.json'),JSON.stringify({synthetic:true,conflictOnly,mixed,unknownOnly,complete,oldConflict,empty:[]},null,2));
 await writeFile(join(output,'order-evidence-results.json'),JSON.stringify({synthetic:true,source:'c72eb6933ecf968a7c58dd97bd31f636dcb1e9d9',workerStarted:false,privateDataUsed:false,results},null,2));
 console.log(`PASS ${results.length} source/store/projection assertions; synthetic temporary store only`);
} finally {
 const target=resolve(directory);assert.ok(target.startsWith(resolve(tmpdir())+sep)&&basename(target).startsWith('fh-committee-orders-'));await rm(target,{recursive:true,force:true});
}
