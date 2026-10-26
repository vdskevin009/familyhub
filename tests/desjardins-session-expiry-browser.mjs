import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
const dir=await mkdtemp(join(tmpdir(),'fh-expiry-'));process.env.FAMILYHUB_WORKER_DATA=dir;
const {restartableDesjardinsExpiry,reopenExpiredDesjardinsSession}=await import('../apps/worker/dist/desjardins-session-expiry.js');
const {loginForClaim,authenticatedClaimPages}=await import('../apps/worker/dist/claim-login.js');
const {tryPortalLogin,submitPortalLogin}=await import('../apps/worker/dist/portal-login.js');
const {claimPortalDiagnostic}=await import('../apps/worker/dist/claim-portal-diagnostic.js');
const {claimPortals}=await import('../apps/worker/dist/claim-preparation.js');
const origin='https://www.agea-gbim.dsf-dfs.com',history='/AGEA-GBIM/Rclmtn/RclmtnTrt/HistoriqueReclamation_ClaimHistory.aspx';
const expired='<title>Session expirée - Expired session</title><h1>Session expirée</h1><p>Expired session</p>';
const browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined});
let passed=0;
try{
 for(const scenario of ['expired','blocked','cooldown','challenge','repeated-expiry','unknown-login']){
  const c=await browser.newContext({serviceWorkers:'block'}),p=await c.newPage();let bootstrap=0,credentials=0,submits=0,clock=Date.now();
  let control=scenario==='blocked'?{blocked:true,reason:'login-incomplete',attemptedAt:new Date(clock-3600000).toISOString()}:scenario==='cooldown'?{blocked:false,attemptedAt:new Date(clock-1000).toISOString()}:{blocked:false};
  const original=structuredClone(control),wait=p.waitForTimeout.bind(p);p.waitForTimeout=async ms=>{clock+=ms;await wait(1);};
  await c.route('**/*',async r=>{
   const u=new URL(r.request().url());
   if(u.href===claimPortals.desjardins){bootstrap++;return r.fulfill(scenario==='repeated-expiry'?{contentType:'text/html; charset=utf-8',body:expired}:{contentType:'text/html; charset=utf-8',body:'<script>location.href="https://id.desjardins.com/login"</script>'});}
   if(u.origin==='https://id.desjardins.com')return r.fulfill({contentType:'text/html; charset=utf-8',body:scenario==='unknown-login'?'<h1>Unknown screen</h1>':`<form method="post" action="${origin+history}"><input id="UserName" type="text"><input id="Password" type="password"><button id="submitButton" type="submit">Login</button></form>`});
   if(u.pathname===history&&r.request().method()==='POST'){submits++;return r.fulfill({contentType:'text/html; charset=utf-8',body:'<table class="tableau-donnees"><tr><td>Synthetic history</td></tr></table>'});}
   return r.fulfill({contentType:'text/html; charset=utf-8',body:expired+(scenario==='challenge'?'<input autocomplete="one-time-code"><p>Verification code</p>':'')});
  });
  await p.goto(origin+'/session-expired.html?token=synthetic-private-token');
  assert.deepEqual((await claimPortalDiagnostic(p)).tabs,[{kind:'session-expired',restartAvailable:scenario!=='challenge'}]);
  const deps={read:async()=>control,save:async(_i,v)=>{control=v;},credentials:async()=>{credentials++;return {version:1,insurer:'desjardins',username:'synthetic',password:'synthetic-only'};},submit:submitPortalLogin,now:()=>clock};
  const attempt=(page,insurer,ready)=>tryPortalLogin(page,insurer,ready,deps);
  const reason=await loginForClaim(p,'desjardins',undefined,attempt);
  assert.equal(reason,scenario==='expired'?undefined:scenario==='blocked'?'login-incomplete':scenario==='cooldown'?'cooldown':scenario==='challenge'?'human-required':'layout-changed',JSON.stringify({scenario,url:p.url(),bootstrap,credentials,submits,title:await p.title()}));
  assert.equal(bootstrap,scenario==='challenge'?0:1,scenario+' bootstrap once');
  assert.equal(credentials,['expired','unknown-login'].includes(scenario)?1:0,scenario+' credential reads');assert.equal(submits,scenario==='expired'?1:0,scenario+' submissions');
  if(scenario==='unknown-login'){assert.equal(control.attemptedAt,undefined);assert.equal(control.blocked,false);assert.equal(control.firstFailure.outcome,'preflight');}
  if(['blocked','cooldown'].includes(scenario))assert.deepEqual(control,original,'existing durable stops remain identical');
  if(scenario==='expired'){assert.equal(control.blocked,false);const timestamp=control.attemptedAt;assert.equal(await loginForClaim(p,'desjardins',undefined,attempt),undefined);assert.equal(control.attemptedAt,timestamp);assert.equal(credentials,1);assert.equal(bootstrap,1);}
  await c.close();passed++;
 }
 for(const scenario of ['foreign','claim-input','history-grid','no-heading','multiple-tabs','navigation-error']){
  const c=await browser.newContext({serviceWorkers:'block'}),p=await c.newPage();let visits=0,reserved=false;
  await c.route('**/*',r=>{visits++;return r.fulfill({contentType:'text/html; charset=utf-8',body:(scenario==='no-heading'?'<p>Session expirée</p>':expired)+(scenario==='claim-input'?'<input name="montantService" value="100">':scenario==='history-grid'?'<table class="tableau-donnees"><tr><td>Synthetic</td></tr></table>':'')});});
  await p.goto((scenario==='foreign'?'https://untrusted.invalid':origin)+history);
  if(scenario==='multiple-tabs'){const other=await c.newPage();await other.goto(origin+'/other');}
  assert.equal((await authenticatedClaimPages(p,'desjardins')).length,0,'expiry never proves authentication');
  const before=visits,reserve=()=>{if(reserved)return false;reserved=true;return true;};
  if(scenario==='navigation-error'){
   assert.equal(await restartableDesjardinsExpiry(p),true);p.goto=async()=>{throw Error('Synthetic navigation outcome unknown');};
   await assert.rejects(reopenExpiredDesjardinsSession(p,reserve),/outcome unknown/);assert.equal(await reopenExpiredDesjardinsSession(p,reserve),false);
  }else{assert.equal(await reopenExpiredDesjardinsSession(p,reserve),false,scenario);assert.equal(reserved,false);assert.equal(visits,before);}
  await c.close();passed++;
 }
 console.log(JSON.stringify({passed,insurerContact:false,coverage:'positive expiry, real durable login gate, session reuse, challenge/unknown/ambiguous stops and no uncertain navigation replay'}));
}finally{await browser.close();await rm(dir,{recursive:true,force:true});}
