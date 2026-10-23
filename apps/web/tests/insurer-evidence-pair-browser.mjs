/** Built PWA acceptance. Synthetic records and mocked worker only. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { resolve, join, extname, sep } from 'node:path';
import { once } from 'node:events';
const root=resolve('apps/web/dist'), output=resolve('output/playwright');
await mkdir(output,{recursive:true});
const server=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname, file=resolve(root,'.'+path.replace(/^\/familyhub/,''));
 if(file!==root&&!file.startsWith(root+sep)){res.writeHead(403);res.end();return;}
 try{const data=await readFile(file===root||path.endsWith('/')?join(root,'index.html'):file);res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml'})[extname(file)]||'text/html');res.end(data)}catch{res.writeHead(404);res.end()}
});
server.listen(0,'127.0.0.1');await once(server,'listening');
const base=`http://127.0.0.1:${server.address().port}/familyhub/`;

const { tmpdir } = await import('node:os');
const dir=await mkdtemp(join(tmpdir(),'familyhub-pair-browser-'));
process.env.FAMILYHUB_WORKER_DATA=dir;
const api=await import('../../worker/dist/invoices.js');
const common={AccountLabel:'Synthetic portal',AccountEmail:'',SourceMessageId:'portal',ThreadId:'portal',InternetMessageId:'',Sender:'Insurer',Subject:'Claim',ReceivedAt:'2026-08-15T12:00:00Z',Category:0,Status:0,Currency:'CAD',Notes:'',Attachments:[],WorkerManaged:true,ReimbursementEligibility:'unknown',ClassificationSource:'rules',AmountSource:'email-text',HasUnsubscribe:false,AttentionLevel:'none',AttentionReason:'',Reasons:[],Member:'Kevin',ServiceDate:'2026-08-14',BilledAmount:140,Confidence:99,NeedsReview:false,DocumentRole:'insurer-statement',DocumentType:'claim'};
const rows=['Scaling, Two units','Root Planing, Two units'].flatMap((label,i)=>[
 {...common,Id:`dj-${i}`,Fingerprint:`dj-${i}`,Provider:'Desjardins',ClaimedService:i?'APLAN. DE RACINES':'DÉTARTRAGE DEUX UNITÉS',Insurer:'desjardins',StructuredSource:'desjardins-portal',ReimbursedAmount:112,DetectedAmount:112},
 {...common,Id:`bc-${i}`,Fingerprint:`bc-${i}`,Provider:'Blue Cross',ClaimedService:label,Insurer:'blue-cross',StructuredSource:'blue-cross-portal',ReimbursedAmount:28,DetectedAmount:28}
]);
let browser;
try {
 browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined});
 for(const width of [390,1440]) {
  await writeFile(join(dir,'invoices.json'),JSON.stringify({items:rows,accounts:{}}));await api.initializeInvoices();
  const context=await browser.newContext({viewport:{width,height:1000},serviceWorkers:'block'}),page=await context.newPage(),posts=[],errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('familyhub.worker.v1',JSON.stringify({Endpoint:'https://synthetic-worker.invalid',ApiKey:'synthetic-key'})));
  await page.route('https://synthetic-worker.invalid/**',async route=>{
   const req=route.request(),path=new URL(req.url()).pathname;
   const reply=body=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body),headers:{'Access-Control-Allow-Origin':'*'}});
   if(req.method()==='OPTIONS')return reply({});
   if(path==='/health')return reply({status:'ok',version:'2.26.19'});
   if(path==='/invoices')return reply(await api.invoiceSnapshot());
   if(req.method()==='POST'){
    const body=req.postDataJSON();posts.push({path,body});
    assert.equal(path,'/invoices/workflow/status');
    await api.setReimbursementWorkflowStatus(body.expenseId,body.status);return reply({status:'saved'});
   }
   return reply({state:'idle',accounts:[]});
  });
  await page.goto(base);
  await page.getByRole('button',{name:/^Closed 2$/}).first().click();
  await page.getByRole('heading',{name:'Scaling, Two units',exact:true}).waitFor();
  await page.getByRole('heading',{name:'Root Planing, Two units',exact:true}).waitFor();
  assert.equal(await page.locator('.expense-card').count(),2);
  const scaling=page.locator('.expense-card').filter({has:page.getByRole('heading',{name:'Scaling, Two units',exact:true})});
  assert.match(await scaling.innerText(),/112\.00/);assert.match(await scaling.innerText(),/28\.00/);
  assert.equal(await scaling.getByText('Invoice missing',{exact:true}).count(),1);
  assert.equal(await scaling.getByRole('button',{name:/Prepare/}).count(),0);
  await scaling.getByRole('combobox').selectOption('open');
  await page.getByRole('button',{name:/^Open 1$/}).first().click();
  await scaling.waitFor();
  await scaling.getByRole('combobox').selectOption('ignore');
  await page.getByRole('button',{name:/^Ignore[d]? 1$/}).first().click();
  await scaling.waitFor();
  await scaling.getByRole('combobox').selectOption('automatic');
  await page.getByRole('button',{name:/^Closed 2$/}).first().click();
  await scaling.waitFor();
  await page.reload();
  await page.getByRole('heading',{name:'Root Planing, Two units',exact:true}).waitFor();
  assert.equal(await page.locator('.expense-card').count(),2);
  assert.ok(posts.every(post=>post.body.expenseId.startsWith('insurer-pair:')));
  assert.equal(posts.length,3);assert.deepEqual(errors,[]);
  await scaling.getByRole('button',{name:'Review nearby Desjardins records'}).click();
  await scaling.getByText('Linked to this claim',{exact:true}).waitFor();
  await page.screenshot({path:join(output,`insurer-pair-${width}.png`),fullPage:true});
  await context.close();console.log(`PASS paired evidence ${width}px: two closed cards, atomic workflow, restore, reload and sources`);
 }
} finally {await browser?.close();server.close();await rm(dir,{recursive:true,force:true});}
