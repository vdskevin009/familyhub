import test from 'node:test';import assert from 'node:assert/strict';import {checkedField,uploadEvidence} from '../apps/worker/dist/claim-field-verification.js';
const approved={key:'a',label:'Paid by other insurer',kind:'otherInsurancePaid',type:'text',value:'64.00'};
test('partial reimbursement and confirmed zero verify only equal freshly observed amounts',()=>{
 assert.equal(checkedField(approved,{value:'64',signatureMatches:true},true).status,'match');assert.equal(checkedField(approved,{value:'80.00',signatureMatches:true},true).status,'mismatch');assert.equal(checkedField({...approved,value:'0'},{value:'0.00',signatureMatches:true},true).status,'match');assert.equal(checkedField(approved,{value:'unknown',signatureMatches:true},true).status,'mismatch');
});
test('stale DOM, missing fields, and unapplied values never get a green check',()=>{
 assert.equal(checkedField(approved,{value:'64.00',signatureMatches:false},true).status,'unreadable');assert.equal(checkedField(approved,null,true).status,'unreadable');assert.equal(checkedField(approved,{value:'64',signatureMatches:true},false).status,'not-filled');
});
test('selected option identifiers and labels, including yes/no, must both match',()=>{
 const a={...approved,kind:'otherInsurance',type:'select',value:'yes',optionLabel:'Yes'};
 assert.equal(checkedField(a,{value:'yes',selectedLabel:'Yes',signatureMatches:true},true).status,'match');assert.equal(checkedField(a,{value:'yes',selectedLabel:'No',signatureMatches:true},true).status,'mismatch');assert.equal(checkedField(a,{value:'no',selectedLabel:'No',signatureMatches:true},true).status,'mismatch');
});
test('file selection is not upload evidence; a unique visible named success is required and failure overrides it',()=>{
 assert.equal(uploadEvidence('original.pdf',[],[]),'unverified');assert.equal(uploadEvidence('original.pdf',['Upload complete'],[]),'unverified');assert.equal(uploadEvidence('original.pdf',['original.pdf uploaded successfully'],[]),'verified');assert.equal(uploadEvidence('original.pdf',['original.pdf uploaded successfully'],['original.pdf upload failed']),'failed');assert.equal(uploadEvidence('original.pdf',['original.pdf uploaded successfully','original.pdf uploaded successfully'],[]),'unverified');
});
