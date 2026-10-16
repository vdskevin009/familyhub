/** Synthetic authentication only. Every browser request is intercepted. */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const dir=await mkdtemp(join(tmpdir(),'familyhub-claim-session-'));process.env.FAMILYHUB_WORKER_DATA=dir;
const {preserveBlueCrossClaimSession,authenticatedClaimPages}=await import('../apps/worker/dist/claim-login.js');
const {tryPortalLogin,submitPortalLogin}=await import('../apps/worker/dist/portal-login.js');
const {openClaimBrowser,prepareCurrentClaimStep,closeClaimBrowser}=await import('../apps/worker/dist/claim-browser.js');
const origin='https://service.pac.bluecross.ca',claim='/ACESWeb/Pages/Claims/eClaim.aspx';
let session;
try {
 const browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined});
 try {
  for(const scenario of ['category','cause','details','foreign','login','unknown','no-cookie','no-marker','save-error','challenge','claim-password']) {
   const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();let writes=0,confirmed=0,payload;
   if(scenario!=='no-cookie')await context.addCookies([{name:'synthetic-session',value:'synthetic-only',domain:'service.pac.bluecross.ca',path:'/'},{name:'unrelated',value:'never-save',domain:'unrelated.invalid',path:'/'}]);
   await context.addInitScript(enabled=>{if(enabled)sessionStorage.setItem('pbcMemberProfileData','synthetic-session-marker');},scenario!=='no-marker');
   const marker=scenario==='cause'?'<input id="form_ucClaimCause_optClaimCauseNo" type="radio">':scenario==='details'?'<input id="form_cmbCoveredLife_Input">':'<input id="form_ucClaimType_optHealth" type="radio">';
   await context.route('**/*',route=>route.fulfill({contentType:'text/html',body:(scenario==='unknown'?'':marker)+(['login','claim-password'].includes(scenario)?'<input type="password">':'')+(scenario==='challenge'?'<label>Enter verification code<input autocomplete="one-time-code"></label>':'')}));
   await page.goto(scenario==='foreign'?'https://unrelated.invalid'+claim:origin+(scenario==='login'?'/member/login/':claim));
   const save=async(path,data)=>{writes++;payload=data;assert.ok(path.endsWith(join('bluecross','auth-state.dpapi')));if(scenario==='save-error')throw Error('Synthetic save refusal');};
   const authenticated=async insurer=>{assert.equal(insurer,'bluecross');confirmed++;};
   if(scenario==='save-error'){await assert.rejects(preserveBlueCrossClaimSession(page,save,authenticated),/Synthetic save refusal/);assert.equal(confirmed,0);}
   else {const result=await preserveBlueCrossClaimSession(page,save,authenticated),success=['category','cause','details'].includes(scenario);assert.equal(result,success,scenario);assert.equal(writes,success?1:0,scenario);assert.equal(confirmed,writes,scenario);}
   if(payload){assert.equal(payload.cookies.length,1);assert.equal(payload.cookies[0].name,'synthetic-session');assert.equal(payload.session.value,'synthetic-session-marker');assert.ok(!JSON.stringify(payload).includes('never-save'));}
   await context.close();
  }
 } finally {await browser.close();}
 for(const scenario of ['expired-cache','blocked-login','cooldown']) {
  let page,signedIn=false,entries=0,submits=0,reads=0,authChecks=0,diagnostic;
  let control=scenario==='blocked-login'?{blocked:true,reason:'login-incomplete',attemptedAt:new Date().toISOString()}:scenario==='cooldown'?{blocked:false,attemptedAt:new Date().toISOString()}:{blocked:false};
  const launch=async()=>{
   const b=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined}),original=b.newContext.bind(b);
   b.newContext=async()=>{
    const context=await original({serviceWorkers:'block'});
    await context.exposeFunction('recordEntry',()=>entries++);
    await context.exposeFunction('recordLogin',()=>{submits++;signedIn=true;});
    await context.route('**/*',async route=>{
     const path=new URL(route.request().url()).pathname;
     if(path===claim&&!signedIn)return route.fulfill({contentType:'text/html',body:'<script>location.replace("/member/login/")</script>'});
     const login='<input id="policy" type="text"><input id="certificate" type="text"><input id="password" type="password"><input type="radio" name="spouse" value="0"><input type="radio" name="spouse" value="1"><button data-synthetic-login="true" onclick="recordLogin().then(()=>location.href=\'/member/\')">Login</button>';
     const home='<div class="caresnet-link"><div class="quick-nav__item--claim" onclick="recordEntry();location.href=\''+claim+'\'"><span>\ue94b</span><span>SUBMIT CLAIMS &amp; FORMS</span></div></div>';
     const details='<h1>Claim Details</h1><input type="text" name="amount" id="form_txtAmount"><table id="grdClaimsGrid"><tr><td>Authenticated synthetic server form</td></tr></table><label><input type="checkbox">Attestation</label><button onclick="window.submitted=true">Submit</button>';
     return route.fulfill({contentType:'text/html; charset=utf-8',body:path===claim?details:path==='/member/login/'?login:home});
    });
    const newPage=context.newPage.bind(context);context.newPage=async()=>{page=await newPage();return page;};return context;
   };return b;
  };
  const credentials={version:1,insurer:'bluecross',policy:'synthetic-policy',certificate:'synthetic-member',password:'synthetic-password',role:'member'};
  const authenticate=async p=>{authChecks++;return tryPortalLogin(p,'bluecross',async()=>(await authenticatedClaimPages(p,'blue-cross')).length===1,{read:async()=>control,save:async(_,state)=>{control=state;},credentials:async()=>{reads++;return credentials;},submit:async(...args)=>{try{assert.equal(await p.locator("button[data-synthetic-login=true]").count(),1,"Synthetic login form required before any fill");await submitPortalLogin(...args);}catch(e){console.error(JSON.stringify({syntheticOnly:true,submitError:e.message,buttons:await p.getByRole("button").allTextContents()}));throw e;}},now:Date.now,diagnose:async(_,d)=>{diagnostic=d;}});};
  const dossier={expenseId:'synthetic-expired-'+scenario,insurer:'blue-cross',portalUrl:origin+'/member/',blocked:false,reviewableWarnings:[],fields:{originalAmount:100},attachments:[]};
  const opened=await openClaimBrowser(dossier,false,false,launch,true,authenticate);session=opened.sessionId;
  assert.equal(opened.step.status,'login-required');assert.equal(entries,1);assert.equal(submits,0);
  const prepared=await prepareCurrentClaimStep(session,async()=>{throw Error('No receipt expected');});
  assert.equal(authChecks,2,scenario+' rechecks login once after stale home');
  if(scenario==='expired-cache') {assert.equal(submits,1,JSON.stringify({status:prepared.step.status,reason:prepared.step.authReason,reads,entries,control,diagnostic}));assert.equal(reads,1);assert.equal(entries,2);assert.equal(control.blocked,false);assert.equal(await page.locator('#form_txtAmount').inputValue(),'100.00');assert.equal(prepared.verification.fields[0].status,'match');assert.equal(await page.getByRole('checkbox',{name:'Attestation'}).isChecked(),false);assert.equal(await page.evaluate(()=>!!window.submitted),false);}
  else {assert.equal(submits,0);assert.equal(reads,0);assert.equal(entries,1);assert.equal(prepared.step.authReason,scenario==='cooldown'?'cooldown':'login-incomplete');}
  await prepareCurrentClaimStep(session,async()=>{throw Error('No receipt expected');});assert.equal(authChecks,2,'No second fallback');assert.equal(submits,scenario==='expired-cache'?1:0);
  await closeClaimBrowser(session);session=undefined;
 }
 console.log(JSON.stringify({passed:14,coverage:'protected session refresh, expired cached home, guarded single login, blocked/cooldown preservation',insurerContact:false,claimSubmitted:false}));
} finally {if(session)await closeClaimBrowser(session);await rm(dir,{recursive:true,force:true});}

