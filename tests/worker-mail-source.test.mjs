import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { createMailAttachmentCache } from '../apps/worker/dist/mail-attachment-cache.js';
import { toInvoice } from '../apps/worker/dist/invoice-model.js';

test('paired plugin routes expose configured source and exact cached originals without OAuth or runner access',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'familyhub-plugin-api-')),email='synthetic@example.test',bytes=Buffer.from('SYNTHETIC original file');
 const source={account:email,messageId:'abcdef123456',attachmentId:'source_attachment',filename:'source.bin',mimeType:'application/octet-stream',size:bytes.length};
 const mail={id:source.messageId,threadId:'thread',internetMessageId:'<synthetic@example.test>',subject:'Receipt',sender:'billing@example.test',receivedAt:'2026-11-01T12:00:00.000Z',text:'CAD 40',labels:[],unsubscribe:false,bulk:false,attachments:[{Id:source.attachmentId,FileName:source.filename,MimeType:source.mimeType,Size:source.size}],attachmentText:''};
 const classification={kind:'receipt',confidence:.99,transaction:true,reimbursement:'unknown',reason:'Synthetic',amount:40,currency:'CAD',category:'travel',member:'unknown',documentRole:'other',insurer:null,serviceDate:null,billedAmount:40,reimbursedAmount:null};
 const invoice=toInvoice(mail,email,'Synthetic',classification,'rules');
 await createMailAttachmentCache(join(directory,'mail-attachments')).save(source,{...source,bytes});
 await writeFile(join(directory,'invoices.json'),JSON.stringify({items:[invoice],accounts:{},corrections:[],decisions:[],matchDecisions:[],workflowRecords:[],reviews:[],unmatchedDecisions:[]}));
 await writeFile(join(directory,'mail-source-policy.json'),JSON.stringify({schema:1,mode:'plugin',accounts:[{email,label:'Synthetic',linkId:'link_synthetic'}]}));
 await writeFile(join(directory,'pairing-key.txt'),'synthetic-key');
 const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
 const child=spawn(process.execPath,['apps/worker/dist/index.js'],{env:{...process.env,FAMILYHUB_WORKER_DATA:directory,FAMILYHUB_WORKER_HOST:'127.0.0.1',FAMILYHUB_WORKER_PORT:String(port),FAMILYHUB_CODEX_PATH:join(directory,'nonexistent-test-only-codex.exe')},stdio:['ignore','pipe','pipe']});
 let logs='';child.stdout.on('data',chunk=>logs+=chunk);child.stderr.on('data',chunk=>logs+=chunk);const ended=once(child,'exit');
 const headers={'x-familyhub-key':'synthetic-key',Origin:'https://vdskevin009.github.io'},call=(path,init={})=>fetch(`http://127.0.0.1:${port}${path}`,init);
 try{
  let ready=false;for(let i=0;i<80;i++){try{if((await call('/health',{headers})).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}assert.ok(ready,logs);
  assert.equal((await call('/invoices')).status,401);
  assert.equal((await call('/invoices/collect',{method:'POST',headers:{...headers,Origin:'https://evil.example'}})).status,403);
  assert.equal((await call('/groceries/collect',{method:'POST'})).status,401);
  const snapshot=await(await call('/invoices',{headers})).json();assert.equal(snapshot.sourceMode,'plugin');assert.equal(snapshot.setupRequired,false);assert.equal(snapshot.accounts[0].sourceMode,'plugin');assert.equal(snapshot.accounts[0].email,email);
  const path=`/invoices/${encodeURIComponent(invoice.Id)}/attachments/${encodeURIComponent(source.attachmentId)}`;
  assert.equal((await call(path)).status,401);const original=await call(path,{headers});assert.equal(original.status,200);assert.deepEqual(Buffer.from(await original.arrayBuffer()),bytes);
  assert.ok((await(await call('/health',{headers})).json()).capabilities.includes('attachment-preparation-v1'));
  assert.equal((await call(path+'/prepare',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:'request_1'})})).status,401);
  assert.equal((await call(path+'/prepare',{method:'POST',headers:{...headers,Origin:'https://evil.example','Content-Type':'application/json'},body:JSON.stringify({requestId:'request_1'})})).status,403);
  const prepared=await call(path+'/prepare',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({requestId:'request_1'})});assert.ok([200,202].includes(prepared.status));
  let status;for(let i=0;i<30;i++){status=await(await call(path+'/preparations/request_1',{headers})).json();if(status.status!=='pending')break;await new Promise(r=>setTimeout(r,10));}assert.equal(status.status,'ready');
  const readyFile=await call(path+'?preparationRequestId=request_1',{headers});assert.equal(readyFile.status,200);assert.equal(readyFile.headers.get('x-content-type-options'),'nosniff');assert.deepEqual(Buffer.from(await readyFile.arrayBuffer()),bytes);
  assert.equal((await call(path+'/preparations/request_1/cancel',{method:'POST'})).status,401);
  assert.equal((await(await call(path+'/preparations/request_1/cancel',{method:'POST',headers})).json()).status,'cancelled');assert.notEqual((await call(path+'?preparationRequestId=request_1',{headers})).status,200);
  const after=JSON.parse(await readFile(join(directory,'invoices.json'),'utf8'));assert.equal(after.items[0].SourceMessageId,invoice.SourceMessageId);assert.equal(after.items[0].Id,invoice.Id);
  const ledgerBeforeFailure=await readFile(join(directory,'invoices.json'),'utf8');
  assert.equal((await call('/invoices/collect',{method:'POST',headers})).status,202);
  let failed;for(let i=0;i<60;i++){failed=await(await call('/invoices',{headers})).json();if(!failed.busy&&failed.error)break;await new Promise(resolve=>setTimeout(resolve,50));}
  assert.equal(failed.busy,false);assert.match(failed.error,/checkpoints were not advanced/);assert.equal(failed.continuationReady,false);
  assert.equal(await readFile(join(directory,'invoices.json'),'utf8'),ledgerBeforeFailure);
  await writeFile(join(directory,'mail-source-policy.json'),'{');const broken=await(await call('/invoices',{headers})).json();assert.equal(broken.sourceMode,'plugin');assert.equal(broken.setupRequired,true);assert.match(broken.error,/policy/);assert.equal((await call('/invoices/collect',{method:'POST',headers})).status,409);
  const cachedBroken=await call(path,{headers});assert.equal(cachedBroken.status,200);assert.deepEqual(Buffer.from(await cachedBroken.arrayBuffer()),bytes);
  const brokenPrepare=await call(path+'/prepare',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({requestId:'request_2'})});assert.ok([200,202].includes(brokenPrepare.status));
  for(let i=0;i<30;i++){status=await(await call(path+'/preparations/request_2',{headers})).json();if(status.status!=='pending')break;await new Promise(r=>setTimeout(r,10));}assert.equal(status.status,'ready');
  assert.doesNotMatch(logs,/link_synthetic|SYNTHETIC original/);
 }finally{child.kill();await ended;await rm(directory,{recursive:true,force:true});}
});
