import test from 'node:test';import assert from 'node:assert/strict';
import {extractHealthcareEvidence}from'../apps/worker/dist/healthcare-evidence.js';
import {repairHealthcareAmounts,toInvoice}from'../apps/worker/dist/invoice-model.js';
import {prepareClaim}from'../apps/worker/dist/claim-preparation.js';
const pdf=`Synthetic Rehab\nSample Patient\nReceipt\nItems and Payments\nItems Details Subtotal Tax Total\nJuly 14, 2026 - 1:00pm, Synthetic therapy\nInvoice #SYN-TAX-001 $190.48 $9.52 $200.00\nDESJARDINS INSURANCE\nAmount not covered: $120.00 -$76.19 -$3.81 -$80.00\nSubtotal $114.29\nGST $5.71\nTotal $120.00\nPayments\nVisa Sample Patient -$120.00\nBalance $0.00`;
const mail={id:'synthetic-message',threadId:'synthetic-thread',internetMessageId:'synthetic@example.test',subject:'Your Receipt - Synthetic Rehab',sender:'clinic@example.test',receivedAt:'2026-07-14T21:00:00Z',text:'',attachmentText:pdf,labels:[],unsubscribe:false,bulk:false,attachments:[{Id:'synthetic-pdf',FileName:'synthetic.pdf',MimeType:'application/pdf',Size:500}]};
const classification={kind:'receipt',confidence:.99,transaction:true,reimbursement:'possible',reason:'Synthetic receipt',amount:200,currency:'CAD',category:'health',member:'Kevin',documentRole:'expense',insurer:null,serviceDate:'2026-07-14',billedAmount:200,reimbursedAmount:null,healthcare:{OriginalBilledAmount:200,PatientPaid:120,PatientBalance:0,AmountNotCovered:120}};
const base=()=>toInvoice(mail,'test@example.test','Synthetic',classification,'codex');

test('paid-in-full zero balance does not replace the labelled patient share in gross arithmetic',()=>{
 const h=extractHealthcareEvidence(mail,structuredClone(classification));
 assert.equal(h.OriginalBilledAmount,200);assert.equal(h.InsurerPayments.desjardins,80);assert.equal(h.PatientPaid,120);assert.equal(h.AmountNotCovered,120);assert.equal(h.PatientBalance,120);assert.deepEqual(h.Conflicts||[],[]);
});
test('a patient share alone keeps gross and insurer payment unknown, never filled from a legacy net',()=>{
 const expense={...base(),BilledAmount:120,Healthcare:{AmountNotCovered:120,PatientPaid:120,OriginalBilledAmount:null}};
 const p=prepareClaim(expense.Id,'blue-cross',[expense],[]);
 assert.equal(p.fields.originalAmount,null);assert.equal(p.fields.otherInsurancePaid,null);assert.ok(p.missing.includes('originalAmount'));assert.equal(p.duplicate.status,'not-verified');
 const h=extractHealthcareEvidence(mail,{...structuredClone(classification),healthcare:{...classification.healthcare,PatientPaid:40}});assert.equal(h.PatientPaid,40);assert.equal(h.AmountNotCovered,120);assert.equal(h.OriginalBilledAmount,200);
});
test('fresh original tax row retires only the proven stale reconstruction and appends an audit record',()=>{
 const original=base(),stale={...original,BilledAmount:80,DetectedAmount:80,Notes:'Keep source notes',Healthcare:{...original.Healthcare,OriginalBilledAmount:80,Conflicts:['OriginalBilledAmount differs from direct-insurance arithmetic (200 vs 80).']}};
 const before=JSON.stringify(stale),fixed=repairHealthcareAmounts(stale,mail);
 assert.equal(fixed.Healthcare.OriginalBilledAmount,200);assert.equal(fixed.BilledAmount,200);assert.deepEqual(fixed.Healthcare.Conflicts,[]);assert.equal(fixed.EvidenceRepairs.length,1);assert.deepEqual(fixed.EvidenceRepairs[0].proof,{invoiceTotal:200,patientShare:120,insurerPaid:80});assert.equal(fixed.EvidenceRepairs[0].previous,80);
 for(const key of ['Id','SourceMessageId','Attachments','Notes','Status','Member','DocumentRole'])assert.deepEqual(fixed[key],stale[key]);assert.equal(JSON.stringify(stale),before);
 const repeated=repairHealthcareAmounts(fixed,mail);assert.equal(repeated.EvidenceRepairs.length,1);
 for(const changed of [pdf.replace('$200.00','$210.00'),pdf.replace('Invoice #SYN-TAX-001','Invoice #OTHER'),pdf.replace('Amount not covered: $120.00','Amount not covered: $110.00')]){
  const result=repairHealthcareAmounts(stale,{...mail,attachmentText:changed});assert.ok(result.Healthcare.Conflicts.length);assert.equal(result.EvidenceRepairs,undefined);
 }
 const unrelated={...stale,Healthcare:{...stale.Healthcare,Conflicts:[...stale.Healthcare.Conflicts,'Conflicting service dates']}};
 assert.deepEqual(repairHealthcareAmounts(unrelated,mail).Healthcare.Conflicts,['Conflicting service dates']);
});
test('primary paid permits secondary preparation in either configured order; true secondary claims stay blocked',()=>{
 for(const[member,insurer,primary,label]of [['Kevin','blue-cross','desjardins','Desjardins'],['Jasmine','desjardins','blue-cross','Blue Cross']]){
  const sourceMail=primary==='blue-cross'?{...mail,attachmentText:pdf.replace('DESJARDINS INSURANCE','BLUE CROSS')}:mail;
  const expense={...base(),Member:member,Healthcare:extractHealthcareEvidence(sourceMail,structuredClone(classification))};
  const c={DocumentIds:[expense.Id],Member:member,ServiceDate:expense.ServiceDate,OriginalAmount:200,PrimaryInsurer:label,MatchAssignments:[],[primary==='desjardins'?'DesjardinsReimbursedAmount':'BlueCrossReimbursedAmount']:80};
  const p=prepareClaim(expense.Id,insurer,[expense],[c]);assert.equal(p.blocked,false);assert.equal(p.coordination.ready,true);assert.equal(p.fields.originalAmount,200);assert.equal(p.fields.otherInsurancePaid,80);
  const pending={Id:'synthetic-pending',DocumentRole:'insurer-statement',Insurer:insurer,Member:member,ServiceDate:expense.ServiceDate,PortalClaimStatus:'pended'};
  assert.equal(prepareClaim(expense.Id,insurer,[expense,pending],[c]).duplicate.status,'possible');
  const processed={...expense,Healthcare:{...expense.Healthcare,InsurerPayments:{...expense.Healthcare.InsurerPayments,[insurer]:0}}};assert.equal(prepareClaim(expense.Id,insurer,[processed],[c]).blocked,true);
 }
});
