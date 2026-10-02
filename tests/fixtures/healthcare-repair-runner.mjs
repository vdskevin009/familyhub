import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { initializeInvoices, collectInvoices, invoiceSnapshot, healthReceiptRepairVersion, invoiceHistoryStart } from '../../apps/worker/dist/invoices.js';
import { toInvoice } from '../../apps/worker/dist/invoice-model.js';
const account = 'test@example.test';
const source = id => ({ id, threadId:'thread', internetMessageId:'<test@example.test>',
  subject:'Fwd: Your Receipt - Example Clinic', sender:'Kevin Vanderstraeten <test@example.test>', receivedAt:'2026-07-19T12:00:00Z',
  text:`Items\nJuly 16, 2026 - 1:15pm, Massage therapy\nInvoice #${id}\nAmount not covered: $60.00\nDesjardins\nSubtotal $57.14`,
  labels:[],attachments:[],unsubscribe:false,bulk:false });
const old = id => ({ ...toInvoice(source(id),account,'Test',{kind:'receipt',confidence:.97,transaction:true,reimbursement:'unknown',reason:'Synthetic',
  amount:200,currency:'CAD',category:'health',member:'Kevin',documentRole:'expense',insurer:null,serviceDate:null,billedAmount:200,reimbursedAmount:null},'codex'),
  Healthcare:undefined,Provider:'Kevin Vanderstraeten',ServiceDate:null,ClaimedService:undefined,CorrectedAt:'2026-07-19',LastDecisionId:'decision' });
const ignored = {...old('ignored'),IgnoredAt:'2026-07-19'};
const path=join(process.env.FAMILYHUB_WORKER_DATA,'invoices.json');
await writeFile(path,JSON.stringify({items:[old('one'),old('two'),ignored],corrections:[{account,kind:'receipt',fingerprint:'test',at:'2026-07-19'}],
  decisions:[{id:'decision',itemId:'test',type:'status',at:'2026-07-19'}],reviews:[],accounts:{[account]:{
    through:Math.floor(Date.now()/1000),healthReceiptRepairVersion:3,healthReceiptRepairPage:'obsolete',invoiceHistoryVersion:1}}}));
await initializeInvoices();
const originalItems=JSON.parse(await readFile(path,'utf8')).items;
let fail=true,queries=[],reads=[],classified=0;
const deps={credentials:async()=>({accounts:[{email:account,label:'Test'}]}),accessToken:async()=>'synthetic',
  classify:async()=>{classified++;throw Error('Known expense must not be reclassified');},
  reviewer:async()=>({verdict:'missing-evidence',candidateId:null,confidence:.5,explanation:'Synthetic',evidenceIds:[]}),
  gmail:async(_token,path)=>{
    if(path.startsWith('messages?')){
      const params=new URL(path,'https://example.test').searchParams,q=params.get('q');
      if(!q.includes('subject:"Your Receipt"')) return {messages:[]};
      assert.ok(q.includes(`after:${invoiceHistoryStart}`)); assert.ok(!q.includes('from:notifications@janeapp.com'));
      const page=params.get('pageToken')||'first'; queries.push(page);
      if(page==='first')return{messages:[{id:'one'},{id:'ignored'}],nextPageToken:'second'};
      if(page==='second'){if(fail)throw Error('Synthetic interruption');return{messages:[{id:'two'}]};}
      throw Error('Obsolete cursor must be reset');
    }
    const id=path.match(/^messages\/([^?]+)\?/)?.[1];reads.push(id);const mail=source(id);
    return{id,threadId:'thread',internalDate:String(Date.parse(mail.receivedAt)),payload:{mimeType:'text/plain',
      headers:[{name:'Subject',value:mail.subject},{name:'From',value:mail.sender}],body:{data:Buffer.from(mail.text).toString('base64url')}}};
  }};
await collectInvoices(deps);
let s=await invoiceSnapshot();assert.equal(s.progress[account].healthReceiptRepairVersion,3);assert.equal(s.progress[account].healthReceiptRepairPage,'second');
await initializeInvoices();fail=false;await collectInvoices(deps);s=await invoiceSnapshot();
assert.equal(s.progress[account].healthReceiptRepairVersion,healthReceiptRepairVersion);assert.equal(s.progress[account].healthReceiptRepairPage,undefined);
assert.deepEqual(queries,['first','second','second']);assert.deepEqual(reads,[]);assert.equal(classified,0);
for(const item of s.items.filter(x=>!x.IgnoredAt)){assert.equal(item.Provider,'Kevin Vanderstraeten');assert.equal(item.ServiceDate,null);
  assert.equal(item.BilledAmount,old('one').BilledAmount);assert.equal(item.CorrectedAt,'2026-07-19');assert.equal(item.LastDecisionId,'decision');}
assert.equal(s.items.find(x=>x.IgnoredAt).Provider,ignored.Provider);
const persisted=JSON.parse(await readFile(path,'utf8'));assert.equal(persisted.corrections.length,1);assert.equal(persisted.decisions.length,1);
assert.deepEqual(persisted.items,originalItems, 'Protected source facts are unchanged across both resumable repair passes');
await collectInvoices(deps);assert.equal(queries.length,3);
console.log('Forwarded receipt traversal resumes and skips every manually controlled record.');
