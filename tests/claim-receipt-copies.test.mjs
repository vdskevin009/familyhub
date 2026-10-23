import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveClaimReceiptCopies} from '../apps/worker/dist/claim-receipt-copies.js';
const copies=[{documentId:'forward',attachmentId:'a',name:'receipt.pdf'}, {documentId:'original',attachmentId:'b',name:'receipt.pdf'}];
const dossier={expenseId:'original',blocked:false,attachments:copies};
const pdf=Buffer.from('%PDF-1.7 synthetic receipt');
const load=async()=>({bytes:pdf,name:'receipt.pdf'});
test('identical PDF copies resolve to the requested source and preserve raw provenance',async()=>{
 const before=JSON.stringify(dossier); const resolved=await resolveClaimReceiptCopies(dossier,load);
 assert.deepEqual(resolved.attachments,[copies[1]]); assert.equal(JSON.stringify(dossier),before);
 assert.notEqual(resolved,dossier);
});
test('same filename and same size do not merge different PDF bytes',async()=>{
 assert.equal(await resolveClaimReceiptCopies(dossier,async(id)=>({bytes:Buffer.from('%PDF-1.7 '+id.padEnd(10)),name:'receipt.pdf'})),dossier);
});
test('unreadable or renamed copies, non-PDF bytes and blocked dossiers abstain',async()=>{
 for(const reader of [async()=>{throw Error('unavailable')},async()=>({bytes:pdf,name:'different.pdf'}),async()=>({bytes:Buffer.from('other'),name:'receipt.pdf'})])
  assert.equal(await resolveClaimReceiptCopies(dossier,reader),dossier);
 const blocked={...dossier,blocked:true}; assert.equal(await resolveClaimReceiptCopies(blocked,()=>{throw Error('no read')}),blocked);
});
test('single, empty and excessive candidate lists require no reads',async()=>{
 for(const attachments of [[],copies.slice(0,1),Array.from({length:6},()=>copies[0])]) {
  const source={...dossier,attachments}; assert.equal(await resolveClaimReceiptCopies(source,()=>{throw Error('no read')}),source);
 }
});
