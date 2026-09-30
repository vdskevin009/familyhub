import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir=await mkdtemp(join(tmpdir(),'familyhub-connector-'));
process.env.FAMILYHUB_WORKER_DATA=dir;
const {prepareConnectorMessage,readConnectorFile}=await import('../apps/worker/dist/connector-intake.js');
const {initializeInvoices,importConnectorMessage}=await import('../apps/worker/dist/invoices.js');
const mail={id:'abcdef012345',threadId:'abcdef012345',internetMessageId:'<example@test.invalid>',subject:'Healthcare invoice',sender:'Sample Clinic',receivedAt:'2025-06-15T07:00:00Z',text:'Invoice #1234. Invoice total $100.00. Service date: 2025-06-15.',labels:['INBOX'],unsubscribe:false,bulk:false,attachments:[]};
const message={account:'second@example.test',label:'Second mailbox',since:'2025-06-15T00:00:00-07:00',through:'2026-10-01T00:00:00-07:00',mail,files:[]};
const classify=async()=>({source:'rules',result:{kind:'invoice',confidence:.99,transaction:true,reimbursement:'possible',reason:'Synthetic labelled invoice',amount:100,currency:'CAD',category:'health',member:'unknown',documentRole:'expense',insurer:null,serviceDate:'2025-06-15',billedAmount:100,reimbursedAmount:null}});
test('connector intake enforces exact inclusive local-date boundary and source constraints',async()=>{
 assert.equal((await prepareConnectorMessage(message)).mail.id,mail.id);
 await assert.rejects(()=>prepareConnectorMessage({...message,mail:{...mail,receivedAt:'2025-06-15T06:59:59Z'}}),/outside/);
 await assert.rejects(()=>prepareConnectorMessage({...message,mail:{...mail,labels:['SENT']}}),/Excluded/);
 await assert.rejects(()=>prepareConnectorMessage({...message,mail:{...mail,id:'../../private'}}),/identity/);
 await assert.rejects(()=>readConnectorFile('../pairing-key.txt'),/reference/);
});
test('dry run, repeat import and restart preserve existing records and manual decisions',async()=>{
 const initial={items:[],corrections:[{account:'first@example.test',fingerprint:'manual',kind:'receipt',at:'2026-01-01'}],decisions:[{id:'saved-decision'}],matchDecisions:[],unmatchedDecisions:[],workflowRecords:[],reviews:[],accounts:{'first@example.test':{through:123}}};
 await writeFile(join(dir,'invoices.json'),JSON.stringify(initial)); await initializeInvoices(true);
 const original=await readFile(join(dir,'invoices.json'),'utf8');
 assert.equal((await importConnectorMessage(message,false,classify)).applied,false);
 assert.equal(await readFile(join(dir,'invoices.json'),'utf8'),original);
 assert.equal((await importConnectorMessage(message,true,classify)).status,'new');
 const after=JSON.parse(await readFile(join(dir,'invoices.json'),'utf8'));
 assert.equal(after.items.length,1); assert.equal(after.items[0].Member,'unknown','mailbox ownership is not patient evidence');
 assert.deepEqual(after.accounts,initial.accounts);assert.deepEqual(after.corrections,initial.corrections);assert.deepEqual(after.decisions,initial.decisions);
 const repeat=await importConnectorMessage(message,true,()=>{throw new Error('Do not reclassify an existing source');});
 assert.equal(repeat.status,'unchanged');await initializeInvoices(true);
 assert.equal((await importConnectorMessage(message,true,classify)).status,'unchanged');
});
test('estimates and veterinary invoices are excluded from benefit intake',async()=>{
 for(const subject of ['Veterinary invoice','Treatment estimate','Confirming Receipt - Thank You For Your Message']){
  assert.equal((await importConnectorMessage({...message,mail:{...mail,id:'abcdef999999',subject}},false,classify)).status,'not-an-invoice');
 }
});

test('separate invoice attachments retain one source email without mixing patients or amounts',async()=>{
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> /Contents 4 0 R >>','<< /Length 0 >>\nstream\n\nendstream'];
 let pdf='%PDF-1.4\n';const offsets=[0];
 for(const [i,o] of objects.entries()){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${o}\nendobj\n`;}
 const xref=Buffer.byteLength(pdf);pdf+='xref\n0 5\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
 const bytes=Buffer.from(pdf);
 const attachments=['one','two'].map(id=>({Id:id,FileName:`Invoice ${id}.pdf`,MimeType:'application/pdf',Size:bytes.length}));
 const multi={...message,mail:{...mail,id:'abcdef888888',text:'Other patient and amount must not leak into the selected invoice.',attachments},files:[]};
 await assert.rejects(()=>prepareConnectorMessage(multi),/multiple PDFs/);
 const ids=[];
 for(const a of attachments){
  const selected={...multi,invoiceAttachmentId:a.Id,files:[{id:a.Id,name:a.FileName,mime:a.MimeType,base64:bytes.toString('base64')}]};
  const prepared=await prepareConnectorMessage(selected);
  assert.equal(prepared.mail.attachments.length,1);assert.equal(prepared.mail.attachments[0].Id,a.Id);
  assert.ok(!prepared.mail.text.includes('Other patient'));assert.equal(prepared.mail.id,multi.mail.id);
  const result=await importConnectorMessage(selected,true,classify);ids.push(result.id);
  assert.equal((await importConnectorMessage(selected,true,classify)).status,'unchanged');
 }
 assert.notEqual(ids[0],ids[1]);
 const stored=JSON.parse(await readFile(join(dir,'invoices.json'),'utf8')).items.filter(i=>ids.includes(i.Id));
 assert.equal(stored.length,2);assert.ok(stored.every(i=>i.SourceMessageId===multi.mail.id&&i.Attachments.length===1));
});
test.after(async()=>{await rm(dir,{recursive:true,force:true});});
