/** Verify a new preparation context reuses an authenticated history entry. */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp,rm,readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const dir=await mkdtemp(join(tmpdir(),'familyhub-desjardins-entry-'));process.env.FAMILYHUB_WORKER_DATA=dir;
const {openClaimBrowser,closeClaimBrowser}=await import('../apps/worker/dist/claim-browser.js');
const {claimPortals,claimPreparationPortals}=await import('../apps/worker/dist/claim-preparation.js');
const {savePrivate}=await import('../apps/worker/dist/private-store.js');
const origin='https://www.agea-gbim.dsf-dfs.com',history='/AGEA-GBIM/Rclmtn/RclmtnTrt/HistoriqueReclamation_ClaimHistory.aspx';
const cookie={name:'synthetic-session',value:'synthetic-valid',domain:'www.agea-gbim.dsf-dfs.com',path:'/',expires:-1,httpOnly:true,secure:true,sameSite:'Lax'};
let session,loginVisits=0,historyVisits=0;
const attemptedAt='2026-01-01T00:00:00.000Z';
await mkdir(join(dir,'desjardins'),{recursive:true});await writeFile(join(dir,'desjardins','login-control.json'),JSON.stringify({blocked:true,reason:'login-incomplete',attemptedAt}));
if(process.platform==='win32')await savePrivate(join(dir,'desjardins','auth-state.dpapi'),{cookies:[cookie],session:{origin,values:{}}});
const launch=async()=>{
 const browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined}),original=browser.newContext.bind(browser);
 browser.newContext=async()=>{
  const c=await original({serviceWorkers:'block'});if(process.platform!=='win32')await c.addCookies([cookie]);
  await c.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname===history&&(await route.request().allHeaders()).cookie?.includes('synthetic-valid')){historyVisits++;return route.fulfill({contentType:'text/html',body:'<table class="tableau-donnees"><tr><td>Synthetic history</td></tr></table>'});}
   loginVisits++;return route.fulfill({contentType:'text/html',body:'<input id="Password" type="password">'});
  });return c;
 };return browser;
};
try {
 for(let visit=0;visit<2;visit++){
  const dossier={expenseId:'synthetic',insurer:'desjardins',portalUrl:claimPortals.desjardins,preparationUrl:claimPreparationPortals.desjardins,blocked:false,reviewableWarnings:[],fields:{},attachments:[]};
  const result=await openClaimBrowser(dossier,false,false,launch,true);session=result.sessionId;
  assert.equal(result.step.status,'navigate');assert.equal(loginVisits,0);assert.equal(historyVisits,visit+1);
  assert.equal(JSON.parse(await readFile(join(dir,'desjardins','login-control.json'),'utf8')).attemptedAt,attemptedAt);
  if(process.platform==='win32'){const diagnostic=JSON.parse(await readFile(join(dir,'desjardins','claim-session-restore-diagnostic.json'),'utf8'));assert.equal(diagnostic.status,'restored');assert.equal(diagnostic.restoredCookieCount,1);assert.ok(!JSON.stringify(diagnostic).includes('synthetic-valid'));}
  await closeClaimBrowser(session);session=undefined;
 }
 console.log(JSON.stringify({passed:2,coverage:'fresh owned context starts at authenticated history, avoids authentication bootstrap, preserves attempt timestamp on repeat',insurerContact:false}));
}finally{if(session)await closeClaimBrowser(session);await rm(dir,{recursive:true,force:true});}