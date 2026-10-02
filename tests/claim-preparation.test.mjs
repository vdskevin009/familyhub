import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareClaim, exactServiceOption, requireClaimUploadConfirmation } from '../apps/worker/dist/claim-preparation.js';
import { blueCrossSuggestion, blueCrossTextField } from '../apps/worker/dist/bluecross-claim-form.js';

const expense = { Id:'expense', Category:0, DocumentRole:'expense', Member:'Kevin', ServiceDate:'2026-09-01',
  BilledAmount:100, Provider:'Sample Clinic', AccountEmail:'test@example.test', SourceMessageId:'abc12345', Attachments:[], Healthcare:{ServiceType:'Physiotherapy'} };
const entry = { Id:'case', DocumentIds:['expense'], Member:'Kevin', ServiceDate:'2026-09-01', OriginalAmount:100, WorkflowStatus:'open', MatchAssignments:[] };
test('absence in saved history never becomes proof of no duplicate', () => {
 const p=prepareClaim('expense','blue-cross',[expense],[entry]);
 assert.equal(p.duplicate.status,'not-verified'); assert.equal(p.submitAllowed,false);
 assert.equal(p.fields.originalAmount,100); assert.equal(p.fields.practitioner,null);
});
test('assigned zero-payment adjudication blocks resubmission to that insurer', () => {
 const s={Id:'claim',DocumentRole:'insurer-statement',Insurer:'desjardins',ReimbursedAmount:0};
 const c={...entry,MatchAssignments:[{ReimbursementDocumentId:'claim'}]};
 assert.equal(prepareClaim('expense','desjardins',[expense,s],[c]).duplicate.status,'recorded');
 assert.equal(prepareClaim('expense','blue-cross',[expense,s],[c]).blocked,false);
});
test('pending same-day claim and direct insurer processing block unsafe duplicates', () => {
 const pending={Id:'pended',DocumentRole:'insurer-statement',Insurer:'blue-cross',Member:'Kevin',ServiceDate:'2026-09-01',PortalClaimStatus:'pended'};
 assert.equal(prepareClaim('expense','blue-cross',[expense,pending],[entry]).duplicate.status,'possible');
 const direct={...expense,Healthcare:{ProcessedInsurers:['desjardins']}};
 assert.equal(prepareClaim('expense','desjardins',[direct],[entry]).blocked,true);
});
test('unknown patient, amount and date remain unknown', () => {
 const p=prepareClaim('expense','desjardins',[{...expense,Member:'unknown',ServiceDate:null,BilledAmount:null}],[]);
 assert.equal(p.fields.patient,null); assert.equal(p.fields.serviceDate,null); assert.equal(p.fields.originalAmount,null);
 assert.ok(p.missing.includes('patient')); assert.ok(p.missing.includes('originalAmount'));
});
test('conflicts, ignored sources and unsupported insurer cannot launch preparation', () => {
 assert.equal(prepareClaim('expense','desjardins',[{...expense,Healthcare:{Conflicts:['Conflicting dates']}}],[entry]).blocked,true);
 assert.equal(prepareClaim('expense','desjardins',[{...expense,IgnoredAt:'2026-09-02'}],[entry]).blocked,true);
 assert.throws(()=>prepareClaim('expense','evil',[expense],[entry]));
 assert.throws(()=>prepareClaim('claim','blue-cross',[{...expense,Id:'claim',DocumentRole:'insurer-statement'}],[entry]));
});
test('service mapping uses current insurer options and never aliases clinical professions', () => {
 const options=[{value:'sw',label:'Social Worker'},{value:'cc',label:'Clinical Counsellor'}];
 assert.equal(exactServiceOption('Social Worker',options),'sw');
 assert.equal(exactServiceOption('Counselling',options),null);
 assert.equal(exactServiceOption('Social Worker',[options[1]]),null);
 assert.equal(exactServiceOption('Social Worker',[options[0],{value:'sw2',label:'Social Worker'}]),null);
});

test('canonical report identity prepares facts and PDFs from its original receipt copies', () => {
 const legacy={...expense,Id:'report',Provider:'Legacy service label',Healthcare:undefined};
 const receipt={...expense,Id:'pdf',Healthcare:{Provider:'Sample Clinic',Practitioner:'Sample Therapist',InvoiceNumber:'INV-test',ServiceType:'Physiotherapy - 30 Min Follow Up Visit (30 minutes)'},Attachments:[{Id:'a',FileName:'receipt.pdf',MimeType:'application/pdf'}]};
 const copy={...receipt,Id:'copy',Healthcare:{...receipt.Healthcare,ServiceType:'Physiotherapy - 30'}};
 const p=prepareClaim('report','blue-cross',[legacy,receipt,copy],[{...entry,DocumentIds:['report','pdf','copy'],DesjardinsReimbursedAmount:80}]);
 assert.equal(p.fields.provider,'Sample Clinic');assert.equal(p.fields.practitioner,'Sample Therapist');
 assert.equal(p.fields.service,receipt.Healthcare.ServiceType);assert.equal(p.fields.invoiceNumber,'INV-test');
 assert.equal(p.fields.otherInsurancePaid,80);assert.equal(p.fields.originalAmount,100);assert.equal(p.attachments[0].documentId,'pdf');assert.equal(p.blocked,false);
});

test('other-insurer money preserves zero and unknown and does not sum duplicated receipts', () => {
 const receipt={...expense,Healthcare:{InsurerPayments:{desjardins:80}}};
 assert.equal(prepareClaim('expense','blue-cross',[receipt,{...receipt,Id:'copy'}],[{...entry,DocumentIds:['expense','copy'],DesjardinsReimbursedAmount:80}]).fields.otherInsurancePaid,80);
 assert.equal(prepareClaim('expense','blue-cross',[expense],[{...entry,DesjardinsReimbursedAmount:0}]).fields.otherInsurancePaid,0);
 assert.equal(prepareClaim('expense','blue-cross',[expense],[entry]).fields.otherInsurancePaid,null);
 assert.equal(prepareClaim('expense','blue-cross',[receipt],[{...entry,HasUnresolvedReimbursementEvidence:true}]).fields.otherInsurancePaid,null);
 assert.equal(prepareClaim('expense','blue-cross',[receipt],[{...entry,DesjardinsReimbursedAmount:70}]).blocked,true);
});

test('only corroborated direct-insurance gross warning can be reviewed for preparation; originals stay untouched', () => {
 const good={...expense,Healthcare:{OriginalBilledAmount:100,AmountNotCovered:20,InsurerPayments:{desjardins:80}}};
 const bad={...good,Id:'copy',Healthcare:{...good.Healthcare,OriginalBilledAmount:80,Conflicts:['OriginalBilledAmount differs from direct-insurance arithmetic (100 vs 80).']}};
 const before=JSON.stringify([good,bad]);
 const p=prepareClaim('expense','blue-cross',[good,bad],[{...entry,DocumentIds:['expense','copy'],DesjardinsReimbursedAmount:80}]);
 assert.equal(p.reviewableWarnings.length,1);assert.equal(p.conflicts.length,1);assert.equal(p.fields.originalAmount,100);assert.equal(p.blocked,false);assert.equal(JSON.stringify([good,bad]),before);
 assert.equal(prepareClaim('copy','blue-cross',[bad],[{...entry,DocumentIds:['copy'],DesjardinsReimbursedAmount:80}]).blocked,true);
 assert.equal(prepareClaim('expense','blue-cross',[{...good,Healthcare:{...good.Healthcare,Conflicts:['Conflicting dates']}}],[entry]).blocked,true);
});

test('Blue Cross maps only unique observed member/service/provider options and a verified calendar mask', () => {
 const p=prepareClaim('expense','blue-cross',[expense],[entry]);
 p.fields.service='Physiotherapy - 30 Min Follow Up Visit (30 minutes)';
 assert.equal(blueCrossSuggestion('service',p,[{value:'30',label:'Physiotherapy Treatment - 30 Minutes'}]),'30');
 p.fields.service='Clinical Counsellor';assert.equal(blueCrossSuggestion('benefit',p,[{value:'sw',label:'Social Worker'}]),null);
 p.fields.service='Physiotherapy - unknown minutes';assert.equal(blueCrossSuggestion('service',p,[{value:'30',label:'Physiotherapy Treatment - 30 Minutes'}]),null);
 assert.equal(blueCrossSuggestion('patient',p,[{value:'one',label:'Kevin - Jan 01, 2000'},{value:'two',label:'Kevin - Jan 02, 2001'}]),null);
 p.fields.practitioner='Sample Therapist';assert.equal(blueCrossSuggestion('practitioner',p,[{value:'p',label:'Sample Therapist Extra - address'}]),null);
 assert.equal(blueCrossSuggestion('serviceDate',p),'09/01/2026');p.fields.serviceDate='2026-02-30';assert.equal(blueCrossSuggestion('serviceDate',p),null);
 assert.equal(blueCrossTextField('form_txtOtherPlanAmt').kind,'otherInsurancePaid');
 assert.equal(blueCrossTextField('form_txtPublicProvincialAmount'),null);
 assert.equal(blueCrossSuggestion('natureOfIllness',p),null);
});

test('receipt upload requires explicit confirmation for either insurer, including false/string consent',()=>{
 for(const insurer of ['desjardins','blue-cross']){
 for(const confirmed of [undefined,false,'true',1])assert.throws(()=>requireClaimUploadConfirmation(insurer,'expense:pdf',confirmed),/Confirm/);
 assert.doesNotThrow(()=>requireClaimUploadConfirmation(insurer,'expense:pdf',true));
 assert.doesNotThrow(()=>requireClaimUploadConfirmation(insurer,null,false));
 }
});
