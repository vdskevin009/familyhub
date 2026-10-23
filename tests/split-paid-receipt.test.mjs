import test from 'node:test';
import assert from 'node:assert/strict';
import {splitPaidReceiptEvidence as evidence, receiptProviderOption} from '../apps/worker/dist/split-paid-receipt.js';
import {detailedReceiptEvidence,verifyDetailedReceipt} from '../apps/worker/dist/bluecross-receipt-checklist.js';
import {splitDossier as d,splitText as text} from './fixtures/split-paid-receipt.mjs';
import {receiptPdf} from './fixtures/detailed-receipt.mjs';
test('split payer receipt proves identity, taxes, applied payments and zero balances',async()=>{
 const found=evidence(text,d);assert.equal(found?.licence,'TEST123');assert.equal(found.practitioner,d.fields.practitioner);
 assert.equal(detailedReceiptEvidence(text,d),true);assert.equal(await verifyDetailedReceipt(receiptPdf(text.replace('-- 1 of 1 --',''),9),d),true);
 assert.equal(evidence(text.replaceAll('\n',' '),d),null,'Missing line structure cannot establish provider address');
});
test('near misses and duplicated evidence cannot confirm a split payer receipt',()=>{
 for(const [from,to] of [
 ['Sample Patient','Different Patient'],['Sample Practitioner RMT','Different Practitioner RMT'],['Invoice #SYN-001','Invoice #OTHER'],
 ['October 1, 2026','October 2, 2026'],['$95.24 $4.76 $100.00','$95.24 $5.76 $100.00'],
 ['-$38.10 -$1.90 -$40.00','-$38.10 -$1.90 -$41.00'],['Subtotal $57.14','Subtotal $58.14'],
 ['Visa $60.00 -$60.00','Visa $60.00 -$59.00'],['$60.00 $60.00 $0.00','$60.00 $59.00 $1.00'],
 ['$40.00 $40.00 $0.00','$40.00 $39.00 $1.00'],['$100.00 $100.00 $0.00','$100.00 $99.00 $1.00'],
 ['Patient\nBalance','Patient\nRefund'],['126 Sample Street','Unknown address'],['License #TEST123','License unknown'],
 ['DESJARDINS INSURANCE','OTHER INSURANCE'],['1x synthetic massage','2x synthetic massage'],
 ['Printed at: October 1, 2026 - 2:34pm','Printed at: October 1, 2026 - 3:34pm']
 ])assert.equal(evidence(text.replaceAll(from,to),d),null,from);
 for(const extra of ['\nRefund $10.00','\nInvoice #SECOND $100.00','\nPayment #EXTRA - Sample Patient, Visa $60.00 -$60.00'])assert.equal(evidence(text+extra,d),null);
 for(const changed of [{...d,blocked:true},{...d,insurer:'desjardins'},...['patient','practitioner','invoiceNumber','service','originalAmount','otherInsurancePaid'].map(key=>({...d,fields:{...d.fields,[key]:null}}))])assert.equal(evidence(text,changed),null);
});

test('RMT provider resolution requires unique exact name AND clinic address',()=>{
 const identity=evidence(text,d),good={value:'p',label:'Sample Practitioner - 126 Sample Street, Suite 110 , Example City'};
 assert.equal(receiptProviderOption(identity,[good]),'p');
 assert.equal(receiptProviderOption(identity,[{...good,label:good.label.replace('110','111')}]),null);
 assert.equal(receiptProviderOption(identity,[{...good,label:good.label.replace('Sample Practitioner','Another Practitioner')}]),null);
 assert.equal(receiptProviderOption(identity,[good,{...good,value:'duplicate'}]),null);
 assert.equal(receiptProviderOption(null,[good]),null);
 assert.equal(receiptProviderOption(identity,[{value:'p',label:'Sample Practitioner'}]),null);
});
