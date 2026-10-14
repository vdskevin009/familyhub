/** Built PWA acceptance. Synthetic records and mocked worker only. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, join, extname, sep } from 'node:path';
import { once } from 'node:events';
import { prepareClaim } from '../../worker/dist/claim-preparation.js';
const root=resolve('apps/web/dist'), output=resolve('output/playwright');
await mkdir(output,{recursive:true});
const server=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname, file=resolve(root,'.'+path.replace(/^\/familyhub/,''));
 if(file!==root&&!file.startsWith(root+sep)){res.writeHead(403);res.end();return;}
 try{const data=await readFile(file===root||path.endsWith('/')?join(root,'index.html'):file);res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml'})[extname(file)]||'text/html');res.end(data)}catch{res.writeHead(404);res.end()}
});
server.listen(0,'127.0.0.1');await once(server,'listening');
const base=`http://127.0.0.1:${server.address().port}/familyhub/`;
const expense={Id:'synthetic-expense',Category:0,DocumentRole:'expense',Member:'Kevin',ServiceDate:'2026-09-01',ReceivedAt:'2026-09-01T12:00:00Z',BilledAmount:100,Provider:'Sample Clinic',AccountEmail:'test@example.test',SourceMessageId:'synthetic-email',Attachments:[],Healthcare:{ServiceType:'Physiotherapy'},WorkerManaged:true,Status:0,Sender:'test@example.test',Subject:'Synthetic receipt',Reasons:[],Currency:'CAD'};
const entry={Id:'synthetic-case',DocumentIds:[expense.Id],ExpenseDocumentId:expense.Id,Member:'Kevin',ServiceDate:expense.ServiceDate,OriginalAmount:100,WorkflowStatus:'open',AutomaticWorkflowStatus:'open',MatchAssignments:[],Provider:expense.Provider,ServiceType:'Physiotherapy',PrimaryInsurer:'Desjardins',SecondaryInsurer:'Blue Cross',PrimaryReimbursedAmount:null,SecondaryReimbursedAmount:null,DesjardinsReimbursedAmount:null,BlueCrossReimbursedAmount:null,ReimbursedAmount:0,PotentialRemaining:100,Currency:'CAD',Status:'waiting-primary',Action:'submit-primary',NextInsurer:'Desjardins',Evidence:{},Reasons:[]};
let browser;
try{
 browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined});
 for(const scenario of ['missing-primary','zero-primary','login-required','navigate']){
  const context=await browser.newContext({viewport:{width:390,height:900},serviceWorkers:'block'}),page=await context.newPage(),errors=[],posts=[];
  const ready=scenario!=='missing-primary', c={...entry,NextInsurer:ready?'Blue Cross':'Desjardins',DesjardinsReimbursedAmount:ready?0:null,Status:ready?'waiting-secondary':'waiting-primary',Action:ready?'submit-secondary':'submit-primary'};
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('familyhub.worker.v1',JSON.stringify({Endpoint:'https://synthetic-worker.invalid',ApiKey:'synthetic-key'})));
  await page.route('https://synthetic-worker.invalid/**',async route=>{
   const req=route.request(),path=new URL(req.url()).pathname;
   const reply=body=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body),headers:{'Access-Control-Allow-Origin':'*'}});
   if(req.method()==='OPTIONS')return reply({});
   if(req.method()==='POST')posts.push({path,body:req.postDataJSON()});
   if(path==='/health')return reply({status:'ok',version:'2.25.3'});
   if(path==='/invoices')return reply({items:[expense],reconciliations:[c],unmatchedReimbursements:[],accounts:[]});
   if(path==='/claim-preparation/preview')return reply(prepareClaim(expense.Id,req.postDataJSON().insurer,[expense],[c]));
   if(path==='/claim-preparation/open')return reply({sessionId:'synthetic-session',step:{status:['login-required','navigate'].includes(scenario)?scenario:'fields',revision:'synthetic-revision',submitAllowed:false,fields:scenario==='zero-primary'?[{key:'amount',label:'Total amount of expense',type:'text',kind:'originalAmount',options:[],suggested:'100.00'},{key:'paid',label:'Amount paid by another insurance plan',type:'text',kind:'otherInsurancePaid',options:[],suggested:'0.00'},{key:'unknown',label:'Unknown clinical detail',type:'text',kind:null,options:[],suggested:null}]:[]}});
   if(path==='/claim-preparation/fill')return reply({message:'Reviewed fields filled. Check them in the preparation window; click Next yourself.'});
   return reply({state:'idle',accounts:[]});
  });
  await page.goto(base);await page.getByRole('button',{name:ready?'Prepare Blue Cross claim':'Prepare claim',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:ready?'Prepare Blue Cross claim':'Prepare Desjardins claim',exact:true});await dialog.waitFor();
  assert.equal(await dialog.getByRole('combobox').first().inputValue(),ready?'blue-cross':'desjardins');
  if(!ready){
   await dialog.getByRole('combobox').first().selectOption('blue-cross');
   await page.getByRole('dialog',{name:'Prepare Blue Cross claim',exact:true}).waitFor();
   await page.getByText(/Its confirmed response\/payment is missing/).waitFor();
   assert.equal(await page.getByRole('button',{name:'Open preparation window on PC',exact:true}).isDisabled(),true);
   assert.equal(posts.filter(p=>p.path.endsWith('/open')).length,0);
  }else{
   await dialog.getByLabel(/I checked the current insurer history/).check();
   await dialog.getByRole('button',{name:'Open preparation window on PC',exact:true}).click();
   if(scenario==='zero-primary'){
    await dialog.getByLabel('Total amount of expense',{exact:true}).waitFor();
    assert.equal(await dialog.getByLabel('Total amount of expense',{exact:true}).inputValue(),'100.00');
    assert.equal(await dialog.getByLabel('Amount paid by another insurance plan',{exact:true}).inputValue(),'0.00');
    assert.equal(posts.filter(p=>p.path.endsWith('/inspect')).length,0,'Open already provides the first inspection');
    assert.equal(await dialog.getByLabel('Unknown clinical detail',{exact:true}).count(),0);
    await page.screenshot({path:join(output,'claim-preparation-reviewed-values.png'),fullPage:true});
    await dialog.getByRole('button',{name:'Fill reviewed fields',exact:true}).click();
    await dialog.getByText(/Reviewed fields filled/).waitFor();
    assert.deepEqual(posts.find(p=>p.path.endsWith('/fill')).body.values,{amount:'100.00',paid:'0.00'});
   }else if(scenario==='login-required')await dialog.getByText(/Complete sign-in in the preparation window on your PC/).waitFor();
   else await dialog.getByText(/The preparation window is open on your PC. Open the claim form there/).waitFor();
   assert.equal(posts.filter(p=>p.path.endsWith('/open')).length,1);
  }
  assert.equal(posts.some(p=>/submit|claim-create|next/.test(p.path)),false);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,scenario+' mobile overflow');
  assert.deepEqual(errors,[]);await page.screenshot({path:join(output,`claim-preparation-${scenario}.png`),fullPage:true});await context.close();
 }
 console.log(JSON.stringify({passed:4,scenarios:['primary-default-and-secondary-block','confirmed-zero-and-open-inspection','manual-login-handoff','manual-navigation-handoff'],providerContact:false,submission:false,screenshots:output}));
}finally{await browser?.close();server.close();}
