import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
const dir=await mkdtemp(join(tmpdir(),'fh-expiry-'));process.env.FAMILYHUB_WORKER_DATA=dir;
const {restartableDesjardinsExpiry,reopenExpiredDesjardinsSession,currentDesjardinsPage,desjardinsConsentCookies}=await import('../apps/worker/dist/desjardins-session-expiry.js');
const {loginForClaim,authenticatedClaimPages}=await import('../apps/worker/dist/claim-login.js');
const {tryPortalLogin,submitPortalLogin}=await import('../apps/worker/dist/portal-login.js');
const {claimPortalDiagnostic}=await import('../apps/worker/dist/claim-portal-diagnostic.js');
const {claimPortals}=await import('../apps/worker/dist/claim-preparation.js');
const origin='https://www.agea-gbim.dsf-dfs.com',history='/AGEA-GBIM/Rclmtn/RclmtnTrt/HistoriqueReclamation_ClaimHistory.aspx';
const expired='<title>Session expirée - Expired session</title><h1>Session expirée</h1><p>Expired session</p>';
const browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined});
const newContext=browser.newContext.bind(browser);
let passed=0;
try{
 for(const scenario of ['expired','blocked','cooldown','challenge','repeated-expiry','unknown-login']){
  const c=await newContext({serviceWorkers:'block'});let bootstrap=0,credentials=0,submits=0,clock=Date.now();
  let control=scenario==='blocked'?{blocked:true,reason:'login-incomplete',attemptedAt:new Date(clock-3600000).toISOString()}:scenario==='cooldown'?{blocked:false,attemptedAt:new Date(clock-1000).toISOString()}:{blocked:false};
  const original=structuredClone(control);
  const wire=async context=>{
   const createPage=context.newPage.bind(context);context.newPage=async()=>{const page=await createPage(),wait=page.waitForTimeout.bind(page);page.waitForTimeout=async ms=>{clock+=ms;await wait(1);};return page;};
   await context.route('**/*',async r=>{
   const u=new URL(r.request().url());
   if(u.href===claimPortals.desjardins){bootstrap++;return r.fulfill(scenario==='repeated-expiry'?{contentType:'text/html; charset=utf-8',body:expired}:{contentType:'text/html; charset=utf-8',body:'<script>location.href="https://id.desjardins.com/login"</script>'});}
   if(u.origin==='https://id.desjardins.com')return r.fulfill({contentType:'text/html; charset=utf-8',body:scenario==='unknown-login'?'<h1>Unknown screen</h1>':`<form method="post" action="${origin+history}"><input id="UserName" type="text"><input id="Password" type="password"><button id="submitButton" type="submit">Login</button></form>`});
   if(u.pathname===history&&r.request().method()==='POST'){submits++;return r.fulfill({contentType:'text/html; charset=utf-8',body:'<table class="tableau-donnees"><tr><td>Synthetic history</td></tr></table>'});}
   return r.fulfill({contentType:'text/html; charset=utf-8',body:expired+(scenario==='challenge'?'<input autocomplete="one-time-code"><p>Verification code</p>':'')});
   });return context;
  };
  await wire(c);browser.newContext=async()=>wire(await newContext({serviceWorkers:'block'}));
  await c.addInitScript(()=>{window.syntheticExpiredRestore=true;});
  await c.addCookies([{name:'synthetic-expired-cookie',value:'stale',domain:'www.agea-gbim.dsf-dfs.com',path:'/'}]);
  const p=await c.newPage();
  await p.goto(origin+'/session-expired.html?token=synthetic-private-token');
  assert.deepEqual((await claimPortalDiagnostic(p)).tabs,[{kind:'session-expired',restartAvailable:scenario!=='challenge'}]);
  const deps={read:async()=>control,save:async(_i,v)=>{control=v;},credentials:async()=>{credentials++;return {version:1,insurer:'desjardins',username:'synthetic',password:'synthetic-only'};},submit:submitPortalLogin,now:()=>clock};
  const attempt=(page,insurer,ready,_deps,recovery,current)=>tryPortalLogin(page,insurer,ready,deps,recovery,current);
  const reason=await loginForClaim(p,'desjardins',undefined,attempt);
  const active=currentDesjardinsPage(p);
  assert.equal(reason,scenario==='expired'?undefined:scenario==='blocked'?'login-incomplete':scenario==='cooldown'?'cooldown':scenario==='challenge'?'human-required':'layout-changed',scenario);
  assert.equal(bootstrap,scenario==='challenge'?0:1,scenario+' bootstrap once');
  assert.equal(credentials,['expired','unknown-login'].includes(scenario)?1:0,scenario+' credential reads');assert.equal(submits,scenario==='expired'?1:0,scenario+' submissions');
  if(scenario==='unknown-login'){assert.equal(control.attemptedAt,undefined);assert.equal(control.blocked,false);assert.equal(control.firstFailure.outcome,'preflight');}
  if(['blocked','cooldown'].includes(scenario))assert.deepEqual(control,original,'existing durable stops remain identical');
  if(scenario!=='challenge'){assert.equal(p.isClosed(),true);assert.notEqual(active.context(),c);assert.equal(await active.evaluate(()=>!!window.syntheticExpiredRestore),false);assert.equal((await active.context().cookies()).some(c=>c.name==='synthetic-expired-cookie'),false);}
  if(scenario==='expired'){assert.equal(control.blocked,false);const timestamp=control.attemptedAt;assert.equal(await loginForClaim(active,'desjardins',undefined,attempt),undefined);assert.equal(control.attemptedAt,timestamp);assert.equal(credentials,1);assert.equal(bootstrap,1);}
  await active.context().close();browser.newContext=newContext;passed++;
 }
 for(const scenario of ['foreign','claim-input','history-grid','no-heading','multiple-tabs','navigation-error']){
  const c=await browser.newContext({serviceWorkers:'block'}),p=await c.newPage();let visits=0,reserved=false;
  await c.route('**/*',r=>{visits++;return r.fulfill({contentType:'text/html; charset=utf-8',body:(scenario==='no-heading'?'<p>Session expirée</p>':expired)+(scenario==='claim-input'?'<input name="montantService" value="100">':scenario==='history-grid'?'<table class="tableau-donnees"><tr><td>Synthetic</td></tr></table>':'')});});
  await p.goto((scenario==='foreign'?'https://untrusted.invalid':origin)+history);
  if(scenario==='multiple-tabs'){const other=await c.newPage();await other.goto(origin+'/other');}
  assert.equal((await authenticatedClaimPages(p,'desjardins')).length,0,'expiry never proves authentication');
  const before=visits,reserve=()=>{if(reserved)return false;reserved=true;return true;};
  if(scenario==='navigation-error'){
   assert.equal(await restartableDesjardinsExpiry(p),true);browser.newContext=async()=>{const fresh=await newContext({serviceWorkers:'block'});await fresh.route('**/*',r=>r.abort('failed'));return fresh;};
   await assert.rejects(reopenExpiredDesjardinsSession(p,reserve),/ERR_FAILED/);assert.equal(await reopenExpiredDesjardinsSession(p,reserve),false);await currentDesjardinsPage(p).context().close();browser.newContext=newContext;
  }else{assert.equal(await reopenExpiredDesjardinsSession(p,reserve),false,scenario);assert.equal(reserved,false);assert.equal(visits,before);}
  await c.close();passed++;
 }
 {
  const c=await newContext({serviceWorkers:'block'}),p=await c.newPage();
  const base={path:'/',expires:Date.now()/1000+3600,httpOnly:false,secure:true,sameSite:'Lax'};
  const prefs=['.desjardins.com','.dsf-dfs.com'].flatMap(domain=>['OptanonConsent','OptanonAlertBoxClosed'].map(name=>({...base,domain,name,value:'synthetic-existing-preference'})));
  const extra=[{...base,domain:'.desjardins.com',name:'session',value:'must-not-copy'},{...base,domain:'.unrelated.invalid',name:'OptanonConsent',value:'foreign-must-not-copy'},{...base,domain:'.desjardins.com',name:'OptanonConsent',value:'expired',expires:1}];
  assert.deepEqual(desjardinsConsentCookies([...prefs,...extra]),prefs,'only unexpired approved-domain privacy choices, without changing values/flags');
  await c.addCookies([...prefs,...extra.slice(0,2)]);await c.addInitScript(()=>{window.syntheticExpiredRestore=true;});
  await c.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:expired}));await p.goto(origin+'/expired.html');
  const expected=desjardinsConsentCookies(await c.cookies());
  browser.newContext=async()=>{const fresh=await newContext({serviceWorkers:'block'});await fresh.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<h1>Login</h1>'}));return fresh;};
  const fresh=await reopenExpiredDesjardinsSession(p,()=>true);
  assert.ok(fresh);assert.equal(p.isClosed(),true);assert.equal(await fresh.evaluate(()=>!!window.syntheticExpiredRestore),false);
  const order=values=>values.sort((a,b)=>(a.domain+a.name).localeCompare(b.domain+b.name));assert.deepEqual(order(await fresh.context().cookies()),order(expected));
  await fresh.context().close();browser.newContext=newContext;passed++;
 }
 {
  const {continueDesjardinsProfileSelection}=await import('../apps/worker/dist/desjardins-profile-selection.js');
  const c=await newContext({serviceWorkers:'block'}),p=await c.newPage();let reservations=0,choices=0;
  await p.exposeFunction('syntheticChoice',()=>choices++);
  const body=`<dsd-form aria-label="profil-select"><dsd-select-tile style="display:block;width:250px;height:50px" onclick="this.checked=true;syntheticChoice()">Synthetic profile</dsd-select-tile><dsd-button style="display:block;width:150px;height:40px" data-testid="primary-button" type="submit" onclick="location.href='${origin+history}'">Continue</dsd-button></dsd-form><div id="onetrust-banner-sdk" style="position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.1)">Synthetic cookie overlay</div>`;
  await c.route('**/*',r=>r.fulfill({contentType:'text/html',body:new URL(r.request().url()).origin===origin?'<table class="tableau-donnees"><tr><td>Synthetic history</td></tr></table>':body}));
  await p.goto('https://id.desjardins.com/staticp/gia-externe-gpap-connect/connexion/selection-profil?state=synthetic-cookie-preflight');
  const reserve=async()=>{reservations++;return true;};
  assert.equal(await continueDesjardinsProfileSelection(p,async()=>undefined,reserve),false);assert.equal(reservations,0);assert.equal(choices,0);
  await p.locator('#onetrust-banner-sdk').evaluate(el=>el.remove());
  assert.equal(await continueDesjardinsProfileSelection(p,async()=>undefined,reserve),true);assert.equal(reservations,1);assert.equal(choices,1);
  await c.close();passed++;
 }
 const {openClaimBrowser,closeClaimBrowser,claimWindowState,inspectClaimStep}=await import('../apps/worker/dist/claim-browser.js');
 for(const scenario of ['cooldown','expired']){
  let owned,id,active,contexts=0,credentials=0,clock=Date.now();
  let control=scenario==='cooldown'?{blocked:false,attemptedAt:new Date(clock-1000).toISOString()}:{blocked:false};
  const deps={read:async()=>control,save:async(_i,v)=>{control=v;},credentials:async()=>{credentials++;return {version:1,insurer:'desjardins',username:'synthetic',password:'synthetic-only'};},submit:submitPortalLogin,now:()=>clock};
  const authenticate=async(page,insurer)=>{const result=await loginForClaim(page,insurer,undefined,(p,i,ready,_d,recovery,current)=>tryPortalLogin(p,i,ready,deps,recovery,current));active=currentDesjardinsPage(page);return result;};
  const launch=async()=>{
   owned=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined});const create=owned.newContext.bind(owned);
   owned.newContext=async()=>{
    const c=await create({serviceWorkers:'block'});contexts++;
    if(contexts===1)await c.addInitScript(()=>{window.syntheticExpiredRestore=true;});
    const createPage=c.newPage.bind(c);c.newPage=async()=>{const p=await createPage(),wait=p.waitForTimeout.bind(p);p.waitForTimeout=async ms=>{clock+=ms;await wait(1);};return p;};
    await c.route('**/*',r=>{const u=new URL(r.request().url());
     if(u.href===claimPortals.desjardins)return r.fulfill({contentType:'text/html; charset=utf-8',body:'<script>location.href="https://id.desjardins.com/login"</script>'});
     if(u.origin==='https://id.desjardins.com')return r.fulfill({contentType:'text/html',body:`<form method="post" action="${origin+history}"><input id="UserName" type="text"><input id="Password" type="password"><button id="submitButton" type="submit">Login</button></form>`});
     return r.fulfill({contentType:'text/html; charset=utf-8',body:u.pathname===history?'<table class="tableau-donnees"><tr><td>Synthetic history</td></tr></table>':expired});
    });return c;
   };return owned;
  };
  try{
   const opened=await openClaimBrowser({expenseId:'synthetic-expiry',insurer:'desjardins',portalUrl:claimPortals.desjardins,preparationUrl:origin+'/session-expired.html',blocked:false,reviewableWarnings:[],fields:{},attachments:[]},false,false,launch,true,authenticate);id=opened.sessionId;
   assert.equal(contexts,2);assert.equal(active.isClosed(),false);assert.equal(await active.evaluate(()=>!!window.syntheticExpiredRestore),false);
   assert.equal(opened.step.status,scenario==='cooldown'?'login-required':'navigate');
   if(scenario==='cooldown')assert.equal(opened.step.authReason,'cooldown');
   assert.equal(credentials,scenario==='cooldown'?0:1);assert.equal(claimWindowState().expired,false);assert.equal(claimWindowState().canClose,true);
   assert.equal((await inspectClaimStep(id)).status,opened.step.status);
  }finally{if(id)await closeClaimBrowser(id);else if(owned?.isConnected())await owned.close();}
  passed++;
 }
 console.log(JSON.stringify({passed,insurerContact:false,coverage:'fresh expiry context through the actual preparation owner, guarded login success and cooldown handoff, reuse and negative stops'}));
}finally{await browser.close();await rm(dir,{recursive:true,force:true});}
