import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MailCollectionRuntime } from '../apps/worker/dist/mail-collection-runtime.js';
import { readMailSourcePolicy, mailSourceReadiness } from '../apps/worker/dist/mail-source-policy.js';
import { planInvoiceMail, planGroceryMail } from '../apps/worker/dist/mail-collection-plan.js';
import { createMailAttachmentCache } from '../apps/worker/dist/mail-attachment-cache.js';
const at=1793534400, account={email:'synthetic@example.test',label:'Synthetic',linkId:'link_synthetic'};
const other={email:'other@example.test',label:'Other',linkId:'link_other'};
const policy=accounts=>({schema:1,mode:'plugin',accounts});
const now=()=>new Date(at*1000);
const raw=(id='abcdef123456')=>({id,threadId:'thread',internalDate:String(at*1000),labelIds:[],payload:{mimeType:'text/plain',headers:[{name:'From',value:'source@example.test'},{name:'Subject',value:'Synthetic'}],body:{size:0,data:''}}});
function batch(request,attachment=false){const mail=raw(),bytes=Buffer.from('ORIGINAL generic binary\0\u0001');let attachments=[];if(attachment){mail.payload={mimeType:'multipart/mixed',headers:mail.payload.headers,body:{size:0},parts:[mail.payload,{mimeType:'application/octet-stream',filename:'original.bin',body:{size:bytes.length,attachmentId:'source_attachment'}}]};attachments=[{messageId:mail.id,attachmentId:'source_attachment',size:bytes.length,data:bytes.toString('base64url')}];}return {schema:1,account:request.account,messages:attachment?[mail]:[],attachments,queries:request.queries.map(q=>({...q,complete:true,pages:[{messageIds:attachment?[mail.id]:[]}]}))};}
const expected={account:account.email,messageId:'abcdef123456',attachmentId:'source_attachment',filename:'original.bin',mimeType:'application/octet-stream',size:25};
async function setup(t,overrides={},accounts=[account]){const directory=await mkdtemp(join(tmpdir(),'familyhub-mail-runtime-'));t.after(()=>rm(directory,{recursive:true,force:true}));await writeFile(join(directory,'mail-source-policy.json'),JSON.stringify(policy(accounts)));const calls=[];const grocery={plan:async(email,stamp)=>planGroceryMail({},email,stamp),collect:async input=>{calls.push(['groceries',input]);return {busy:false,incomplete:false,accounts:[],counts:{examined:0,imported:0,unchanged:0,conflicts:0}};},status:async()=>({busy:false,incomplete:false,accounts:[],counts:{examined:0,imported:0,unchanged:0,conflicts:0}})};
const deps={directory,grocery,now,invoicePlan:(email,stamp)=>planInvoiceMail({},[],email,stamp),collectInvoices:async input=>{calls.push(['invoices',input]);},importBlueCross:async(...args)=>{calls.push(['bluecross',args]);return {applied:false};},runner:async request=>batch(request),originalRunner:async()=>{throw Error("Synthetic original runner not configured");},...overrides};return {directory,calls,deps,runtime:new MailCollectionRuntime(deps)};}

test('policy missing is legacy; malformed, duplicate and unsupported explicit selections never fallback',async t=>{const f=await setup(t);assert.deepEqual(await mailSourceReadiness(f.directory),{mode:'plugin',ready:true});for(const bad of ['{',JSON.stringify({schema:1,mode:'legacy'}),JSON.stringify(policy([account,account])),JSON.stringify(policy([{...account,email:'UPPER@example.test'}]))]){await writeFile(join(f.directory,'mail-source-policy.json'),bad);await assert.rejects(readMailSourcePolicy(f.directory));}await rm(join(f.directory,'mail-source-policy.json'));assert.deepEqual(await readMailSourcePolicy(f.directory),{schema:1,mode:'legacy'});assert.deepEqual(await mailSourceReadiness(f.directory),{mode:'legacy',ready:false});});

test('all configured plugin accounts feed one combined invoice and grocery application with fresh plans',async t=>{const requests=[];const f=await setup(t,{runner:async request=>{requests.push(request);return batch(request);}},[account,other]);assert.deepEqual(await f.runtime.accounts(),[{email:account.email,label:account.label,sourceMode:'plugin'},{email:other.email,label:other.label,sourceMode:'plugin'}]);await f.runtime.collectInvoices();await f.runtime.collectGroceries();assert.equal(f.calls.length,2);for(const [,input]of f.calls){assert.equal(input.plans.length,2);assert.deepEqual((await input.source.accounts()).map(a=>a.email),[account.email,other.email]);}assert.equal(requests.length,4);assert.equal(requests[0].queries.length,3);assert.equal(requests[2].queries.length,1);assert.equal(f.runtime.status().error,undefined);});

test('all validated originals are cached before application regardless of classifier eligibility',async t=>{let checked=false;const f=await setup(t,{runner:async request=>batch(request,true)});f.deps.collectInvoices=async()=>{const bytes=await createMailAttachmentCache(join(f.directory,'mail-attachments')).readSource({...expected,size:Buffer.from('ORIGINAL generic binary\0\u0001').length});assert.equal(bytes.toString(),'ORIGINAL generic binary\0\u0001');checked=true;};await f.runtime.collectInvoices();assert.equal(checked,true);});

test('cache source conflict aborts before collector coverage or decisions can change',async t=>{const f=await setup(t,{runner:async request=>batch(request,true)});const source={...expected,size:Buffer.from('ORIGINAL generic binary\0\u0001').length};const cache=createMailAttachmentCache(join(f.directory,'mail-attachments'));await cache.save(source,{...source,bytes:Buffer.alloc(source.size,1)});await assert.rejects(f.runtime.collectInvoices());assert.equal(f.calls.length,0);assert.match(f.runtime.status().error,/checkpoints were not advanced/);});

test('same worker lifecycle owns retrieval cancellation, waits for shutdown, and rejects overlapping triggers',async t=>{let start,finish;const started=new Promise(r=>start=r);const f=await setup(t,{runner:async(_request,{signal})=>new Promise((resolve,reject)=>{start();signal.addEventListener('abort',()=>{finish=()=>reject(new Error('Stopped'));},{once:true});})});const running=f.runtime.collectInvoices();await started;assert.equal(f.runtime.isBusy(),true);await assert.rejects(f.runtime.collectGroceries(),/already running/);assert.equal(f.runtime.cancel(),true);assert.equal(f.runtime.isBusy(),true);await assert.rejects(f.runtime.collectInvoices(),/already running/);finish();await assert.rejects(running);assert.equal(f.runtime.isBusy(),false);assert.equal(f.calls.length,0);});

test('retrieval timeout aborts its source and never applies a delayed result',async t=>{const f=await setup(t,{timeoutMs:20,runner:async(_request,{signal})=>new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>setTimeout(()=>reject(new Error('timeout')),10),{once:true});})});const keeper=setTimeout(()=>{},1000);try{await assert.rejects(f.runtime.collectInvoices());assert.equal(f.calls.length,0);assert.equal(f.runtime.isBusy(),false);}finally{clearTimeout(keeper);}});

test('source-policy changes during retrieval invalidate the attempt before application',async t=>{let f;f=await setup(t,{runner:async request=>{await writeFile(join(f.directory,'mail-source-policy.json'),JSON.stringify(policy([other])));return batch(request);}});await assert.rejects(f.runtime.collectInvoices());assert.equal(f.calls.length,0);});

test('post-application failure makes no false rollback or unchanged-checkpoint claim',async t=>{const f=await setup(t,{collectInvoices:async()=>{throw new Error('Synthetic partial apply');}});await assert.rejects(f.runtime.collectInvoices());assert.match(f.runtime.status().error,/Some verified pages may already be saved/);assert.doesNotMatch(f.runtime.status().error,/not advanced/);});

test('bounded source failure exposes sanitized status and does not invoke legacy or collector paths',async t=>{const f=await setup(t,{runner:async()=>{throw new Error('private link and token must not escape');}});await assert.rejects(f.runtime.collectInvoices(),/Mail retrieval/);assert.equal(f.calls.length,0);const status=await readFile(join(f.directory,'mail-runtime-status.json'),'utf8');assert.doesNotMatch(status,/private link|token|synthetic-link/);assert.match(status,/checkpoints were not advanced/);});

test('corrupt runtime status is preserved instead of being overwritten by a retry',async t=>{const f=await setup(t);const path=join(f.directory,'mail-runtime-status.json');await writeFile(path,'{not valid');const runtime=new MailCollectionRuntime(f.deps);await assert.rejects(runtime.collectInvoices());assert.equal(await readFile(path,'utf8'),'{not valid');assert.equal(f.calls.length,0);});

test('exact original attachment uses persistent cache across restart and never direct Gmail fallback',async t=>{let calls=0;const f=await setup(t,{runner:async()=>{throw Error('Manual original must not collect a batch');},originalRunner:async request=>{calls++;assert.equal(request.expected.messageId,expected.messageId);assert.equal(request.linkId,account.linkId);return Buffer.from('ORIGINAL generic binary\0\u0001');}});const source={...expected,size:Buffer.from('ORIGINAL generic binary\0\u0001').length};assert.equal((await f.runtime.attachment(source)).toString(),'ORIGINAL generic binary\0\u0001');const again=new MailCollectionRuntime({...f.deps,originalRunner:async()=>{throw new Error('Cache should serve it');}});assert.equal((await again.attachment(source)).toString(),'ORIGINAL generic binary\0\u0001');assert.equal(calls,1);await assert.rejects(again.attachment({...source,account:'unconfigured@example.test'}));});

test('manual Blue Cross import stays source-bound and validates originals before existing importer',async t=>{const f=await setup(t,{runner:async request=>{assert.deepEqual(request.queries,[]);assert.deepEqual(request.messageIds,['abcdef123456']);return batch(request,true);}});await f.runtime.importBlueCross(account.email,['abcdef123456'],false);assert.equal(f.calls[0][0],'bluecross');assert.equal(f.calls[0][1][2],false);assert.equal(f.calls[0][1][3].source.transport,'plugin-batch');await assert.rejects(f.runtime.importBlueCross('other@example.test',['abcdef123456'],true));});

test('a repaired valid policy can be revalidated after an invalid policy without activating fallback',async t=>{const f=await setup(t);await writeFile(join(f.directory,'mail-source-policy.json'),'{');await assert.rejects(f.runtime.accounts());await assert.rejects(f.runtime.collectInvoices());assert.equal(f.calls.length,0);await writeFile(join(f.directory,'mail-source-policy.json'),JSON.stringify(policy([account])));await f.runtime.collectInvoices();assert.equal(f.calls.length,1);assert.equal(f.runtime.status().sourceMode,'plugin');});


test('missing policy after plugin selection never restores OAuth, while explicit local rollback remains possible',async t=>{
 const f=await setup(t);await f.runtime.accounts();await rm(join(f.directory,'mail-source-policy.json'));
 await assert.rejects(readMailSourcePolicy(f.directory),/explicit source rollback/);
 await assert.rejects(mailSourceReadiness(f.directory));
 const restarted=new MailCollectionRuntime(f.deps);await assert.rejects(restarted.collectInvoices());assert.equal(f.calls.length,0);
 await writeFile(join(f.directory,'mail-source-policy.json'),JSON.stringify({schema:1,mode:'legacy',allowDirectGmail:true}));
 assert.deepEqual(await readMailSourcePolicy(f.directory),{schema:1,mode:'legacy'});
});

test('lost final status persistence cannot report an unqualified successful operation',async t=>{
 let writes=0;const f=await setup(t,{writeStatus:async()=>{if(++writes===2)throw new Error('Synthetic final status write failed');}});
 await assert.rejects(f.runtime.collectInvoices(),/unverified/);assert.equal(f.calls.length,1);assert.match(f.runtime.status().error,/could not be saved/);assert.equal(f.runtime.isBusy(),false);
});

test('late batch returned after cancellation cannot reach cache or collector application',async t=>{
 let start,release;const started=new Promise(resolve=>start=resolve);const f=await setup(t,{runner:async request=>new Promise(resolve=>{start();release=()=>resolve(batch(request));})});
 const run=f.runtime.collectInvoices();await started;f.runtime.cancel();release();await assert.rejects(run);assert.equal(f.calls.length,0);assert.equal((await readdir(f.directory)).includes('mail-attachments'),false);
});


test('grocery and on-demand originals reject changed source policy before cache or application',async t=>{
 for(const domain of ['groceries','attachment']) {let f;f=await setup(t,{runner:async request=>{await writeFile(join(f.directory,'mail-source-policy.json'),JSON.stringify(policy([other])));return batch(request,true);},originalRunner:async()=>{await writeFile(join(f.directory,'mail-source-policy.json'),JSON.stringify(policy([other])));return Buffer.from('ORIGINAL generic binary\0\u0001');}});
 await assert.rejects(domain==='groceries'?f.runtime.collectGroceries():f.runtime.attachment({...expected,size:Buffer.from('ORIGINAL generic binary\0\u0001').length}));
 assert.equal(f.calls.length,0);await assert.rejects(createMailAttachmentCache(join(f.directory,'mail-attachments')).readSource(expected));
 }
});


test('unnamed binary originals are cached before apply with empty filename and no invented ledger attachment',async t=>{
 let captured;const f=await setup(t,{runner:async request=>{const value=batch(request,true);value.messages[0].payload.parts[1].filename='';value.messages[0].payload.parts[1].mimeType='image/png';captured=value;return value;}});
 const source={...expected,filename:'',mimeType:'image/png',size:Buffer.from('ORIGINAL generic binary\0\u0001').length};let applied=false;
 f.deps.collectInvoices=async()=>{const cache=createMailAttachmentCache(join(f.directory,'mail-attachments'));assert.equal((await cache.lookup(source)).filename,'');assert.equal((await cache.readSource(source)).length,source.size);const {normalizeMail}=await import('../apps/worker/dist/gmail-client.js');assert.deepEqual(normalizeMail(captured.messages[0]).attachments,[]);applied=true;};
 await f.runtime.collectInvoices();assert.equal(applied,true);assert.deepEqual(await createMailAttachmentCache(join(f.directory,'mail-attachments')).readSource(source),Buffer.from('ORIGINAL generic binary\0\u0001'));
});

test('cache-only original miss never starts a retrieval and malformed policy cannot revoke verified private bytes',async t=>{
 let runs=0;const f=await setup(t,{runner:async()=>{runs++;throw Error('must not run');}});
 await assert.rejects(f.runtime.attachment(expected,{cacheOnly:true}),/Prepare this original/);assert.equal(runs,0);
 const bytes=Buffer.alloc(expected.size,1);await createMailAttachmentCache(join(f.directory,'mail-attachments')).save(expected,{...expected,bytes});
 await writeFile(join(f.directory,'mail-source-policy.json'),'{');assert.deepEqual(await f.runtime.attachment(expected,{cacheOnly:true}),bytes);assert.equal(runs,0);
 await assert.rejects(f.runtime.attachment({...expected,attachmentId:'missing'},{cacheOnly:true}));assert.equal(runs,0);
});
test('original job external cancellation aborts retrieval and holds shared lock through shutdown',async t=>{
 let start,release;const started=new Promise(r=>start=r),controller=new AbortController();
 const f=await setup(t,{originalRunner:async(_request,{signal})=>new Promise((resolve,reject)=>{start();signal.addEventListener('abort',()=>{release=()=>reject(Error('stopped'));},{once:true});})});
 const running=f.runtime.attachment(expected,{signal:controller.signal});await started;controller.abort();assert.equal(f.runtime.isBusy(),true);release();await assert.rejects(running);assert.equal(f.runtime.isBusy(),false);assert.equal((await readdir(f.directory)).includes('mail-attachments'),false);
});
