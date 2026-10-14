import test from 'node:test';
import assert from 'node:assert/strict';
import { detailedReceiptEvidence, verifyDetailedReceipt } from '../apps/worker/dist/bluecross-receipt-checklist.js';
import { receiptText, receiptDossier, receiptPdf } from './fixtures/detailed-receipt.mjs';

test('observed receipt format establishes every checklist item from the matching PDF',async()=>{
 assert.equal(detailedReceiptEvidence(receiptText,receiptDossier),true);
 assert.equal(await verifyDetailedReceipt(receiptPdf(receiptText),receiptDossier),true);
 for(const change of [
  ['#100 - 123 Sample St., Example City, BC, V1A 2B3',''], ['Sample Patient','Different Patient'],
  ['October 13, 2026','October 12, 2026'], ['Invoice #SYN-001','Invoice #SYN-002'],
  ['Status: authorized succeeded','Status: declined'], ['Amount: $80.00','Amount: $40.00'],
  ['Payer Total $80.00','Payer Total $100.00'], ['Dr. Sample Practitioner','Dr. Someone Else'],
  ['Synthetic Clinic','Another Clinic'], ['Receipt','Invoice'], ['Items Details Amount','Unknown layout'],
 ]) assert.equal(detailedReceiptEvidence(receiptText.replaceAll(...change),receiptDossier),false,change[0]);
 for(const extra of ['\nInvoice #SYN-002 $80.00','\nStatus: authorized succeeded','\nRefund $80.00'])
  assert.equal(detailedReceiptEvidence(receiptText+extra,receiptDossier),false);
 assert.equal(detailedReceiptEvidence(receiptText,{...receiptDossier,blocked:true}),false);
 assert.equal(await verifyDetailedReceipt(Buffer.from('not a PDF'),receiptDossier),false);
 assert.equal(await verifyDetailedReceipt(Buffer.from('%PDF-broken'),receiptDossier),false);
});
