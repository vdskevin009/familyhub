import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareClaim, exactServiceOption } from '../apps/worker/dist/claim-preparation.js';

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
