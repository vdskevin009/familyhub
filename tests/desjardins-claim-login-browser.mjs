/** Entirely intercepted synthetic portal; no real credentials or insurer requests. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(new URL('../apps/worker/package.json', import.meta.url));
const { chromium } = require('playwright');
const directory = await mkdtemp(join(tmpdir(), 'familyhub-desjardins-signin-'));
process.env.FAMILYHUB_WORKER_DATA = directory;
const { loginForClaim, preserveDesjardinsClaimSession, authenticatedClaimPages } = await import('../apps/worker/dist/claim-login.js');
const origin = 'https://www.agea-gbim.dsf-dfs.com';
const dossier = '/AGEA-GBIM/Athntfctn/AccsDssrAdhrnt/SelectionDossierAdherent_SelectMemberFile.aspx';
const history = '/AGEA-GBIM/Rclmtn/RclmtnTrt/HistoriqueReclamation_ClaimHistory.aspx';
await mkdir(join(directory, 'desjardins'));
await writeFile(join(directory, 'desjardins', 'login-control.json'), JSON.stringify({blocked:true,reason:'login-incomplete',attemptedAt:new Date(Date.now()-3600000).toISOString()}));
const browser = await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined});
try {
 const context = await browser.newContext({serviceWorkers:'block'});
 let selections = 0;
 await context.exposeFunction('selected',()=>{selections++;});
 await context.route('**/*',route=>{
  const path = new URL(route.request().url()).pathname;
  const body = path===dossier ? `<div class="panel-dossier"><div class="panel-body-dossier">ACTIF</div><input type="submit" id="grdListeAdherent_ChoisirButton" value="Choisir" onclick="selected().then(()=>location.href='/home')"></div>` : path==='/home' ? `<a href="${history}">Réclamations traitées</a>` : '<table class="tableau-donnees"><tr><td>Synthetic history</td></tr></table>';
  return route.fulfill({contentType:'text/html; charset=utf-8',body});
 });
 if(process.platform==='win32') await context.addCookies([{name:'synthetic-auth',value:'synthetic-only',domain:'www.agea-gbim.dsf-dfs.com',path:'/'}]);
 const page = await context.newPage();
 await page.goto(origin+dossier);
 assert.equal(await loginForClaim(page,'desjardins'),undefined,'Preparation must complete the established active-dossier and history navigation without another password');
 assert.equal(selections,1);
 assert.equal(new URL(page.url()).pathname,history);

 if(process.platform==='win32') assert.equal(JSON.parse(await readFile(join(directory,'desjardins','login-control.json'),'utf8')).blocked,false);
 const attemptedAt=JSON.parse(await readFile(join(directory,'desjardins','login-control.json'),'utf8')).attemptedAt;
 assert.equal(await loginForClaim(page,'desjardins'),undefined);
 assert.equal(JSON.parse(await readFile(join(directory,'desjardins','login-control.json'),'utf8')).attemptedAt,attemptedAt,'Session reuse makes no password attempt');
 assert.equal(selections,1,'Post-login selection is never replayed');
 await context.close();
 const {desjardinsRestorableCookies}=await import('../apps/worker/dist/desjardins-collector.js');
 const restoredContext=await browser.newContext();
 await restoredContext.addCookies([{name:'session',value:'old-persistent-session',domain:'www.agea-gbim.dsf-dfs.com',path:'/'}]);
 const refreshed=[{name:'session',value:'new-verified-session',domain:'www.agea-gbim.dsf-dfs.com',path:'/',expires:-1,httpOnly:true,secure:true,sameSite:'Lax'},
 {name:'expired',value:'exclude',domain:'www.agea-gbim.dsf-dfs.com',path:'/',expires:1},
 {name:'foreign',value:'exclude',domain:'unrelated.invalid',path:'/',expires:-1}];
 await restoredContext.addCookies(desjardinsRestorableCookies(refreshed));
 const cookies=await restoredContext.cookies();
 assert.equal(cookies.find(c=>c.name==='session').value,'new-verified-session');
 assert.equal(cookies.length,1);await restoredContext.close();
 const {continueDesjardinsDossierSelection,claimActiveDossierSelection}=await import('../apps/worker/dist/desjardins-dossier-selection.js');
 assert.equal(await claimActiveDossierSelection(),false,'A restarted page cannot replay this login attempt dossier choice');
 for(const scenario of ['ambiguous','inactive','disabled','challenge','foreign','uncertain']) {
  const c=await browser.newContext({serviceWorkers:'block'}),p=await c.newPage();let clicks=0,reservations=0;
  await c.exposeFunction('clicked',()=>clicks++);
  const panel=(status,disabled='')=>'<div class="panel-dossier"><div class="panel-body-dossier">'+status+'</div><input type="submit" id="grdListeAdherent_ChoisirButton" value="Choisir" '+disabled+' onclick="clicked().then(()=>document.body.dataset.clickRecorded=\'yes\')"></div>';
  const body=panel(scenario==='inactive'?'INACTIF':'ACTIF',scenario==='disabled'?'disabled':'')+(scenario==='ambiguous'?panel('ACTIVE'):'')+(scenario==='challenge'?'<input autocomplete="one-time-code"><p>Enter verification code</p>':'');
  await c.route('**/*',r=>r.fulfill({contentType:'text/html',body}));
  await p.goto((scenario==='foreign'?'https://foreign.invalid':origin)+dossier);
  p.waitForURL=async()=>{throw Error('Synthetic uncertain redirect');};
  const claim=async()=>{reservations++;return true;};
  assert.equal(await continueDesjardinsDossierSelection(p,claim),false,scenario);
  assert.equal(await continueDesjardinsDossierSelection(p,claim),false,scenario+' repeat');
  // The synthetic navigation wait rejects immediately. Await the exposed
  // callback before reading its host counter; a click does not await that IPC.
  if(scenario==='uncertain')await p.waitForFunction(()=>document.body.dataset.clickRecorded==='yes');
  assert.equal(clicks,scenario==='uncertain'?1:0,scenario);
  assert.equal(reservations,clicks,scenario);
  await c.close();
 }
 for(const scenario of ['history','claim-type','claim-person','foreign','unknown-path','dossier-table','challenge','password','duplicate-grid','multiple-tabs','no-cookie','save-error']) {
  const c=await browser.newContext({serviceWorkers:'block'}),p=await c.newPage();let saves=0,clears=0,payload;
  if(scenario!=='no-cookie')await c.addCookies([{name:'synthetic-auth',value:'synthetic-only',domain:'www.agea-gbim.dsf-dfs.com',path:'/'},{name:'unrelated',value:'must-not-save',domain:'unrelated.invalid',path:'/'}]);
  const claimPath=scenario==='claim-type'?'/AGEA-GBIM/Reclamation/TypeReclamation_TypeOfClaim.aspx':'/AGEA-GBIM/Reclamation/PersonneAssuree_InsuredPerson.aspx';
  const marker=scenario.startsWith('claim-')?'<input type="radio" name="'+(scenario==='claim-type'?'typeReclamation':'personneAssuree')+'">':'<table class="tableau-donnees"><tr><td>Synthetic</td></tr></table>';
  await c.route('**/*',r=>r.fulfill({contentType:'text/html',body:marker+(scenario==='duplicate-grid'?marker:'')+(scenario==='challenge'?'<p>Enter verification code</p>':'')+(scenario==='password'?'<input type="password">':'')}));
  await p.goto((scenario==='foreign'?'https://foreign.invalid':origin)+(scenario==='dossier-table'?dossier:scenario==='unknown-path'?'/unknown':scenario.startsWith('claim-')?claimPath:history));
  if(scenario==='multiple-tabs'){const other=await c.newPage();await other.goto(origin+history);}
  const save=async(_path,value)=>{saves++;payload=value;if(scenario==='save-error')throw Error('Synthetic storage failure');};
  const clear=async insurer=>{assert.equal(insurer,'desjardins');clears++;};
  if(scenario==='save-error'){await assert.rejects(preserveDesjardinsClaimSession(p,save,clear),/Synthetic storage failure/);assert.equal(clears,0);}
  else {const ok=['history','claim-type','claim-person'].includes(scenario);assert.equal(await preserveDesjardinsClaimSession(p,save,clear),ok,scenario);assert.equal(saves,ok?1:0,scenario);assert.equal(clears,saves,scenario);}
  if(payload){assert.equal(payload.cookies.length,1);assert.ok(!JSON.stringify(payload).includes('must-not-save'));}
  await c.close();
 }
 // A post-password selection may be the only active page in a new tab.
 for(const scenario of ['alternate-profile','alternate-dossier','ambiguous-selections']) {
  const c=await browser.newContext({serviceWorkers:'block'}),original=await c.newPage();let choices=0;
  await c.exposeFunction('choiceObserved',()=>choices++);
  const profilePath='/staticp/gia-externe-gpap-connect/connexion/selection-profil';
  await c.route('**/*',r=>{
   const path=new URL(r.request().url()).pathname;
   const html=path===profilePath?'<dsd-form aria-label="profil-select"><dsd-select-tile onclick="this.checked=true">Synthetic profile</dsd-select-tile><dsd-button data-testid="primary-button" type="submit" onclick="choiceObserved().then(()=>location.href=&quot;'+origin+'/home&quot;)">Continue</dsd-button></dsd-form>':path===dossier?'<div class="panel-dossier"><div class="panel-body-dossier">ACTIF</div><input type="submit" id="grdListeAdherent_ChoisirButton" value="Choisir" onclick="choiceObserved().then(()=>location.href=&quot;/home&quot;)"></div>':path==='/home'?'<a href="'+history+'">Réclamations traitées</a>':path===history?'<table class="tableau-donnees"><tr><td>Synthetic history</td></tr></table>':'<input type="password">';
   return r.fulfill({contentType:'text/html; charset=utf-8',body:html});
  });
  await original.goto('https://id.desjardins.com/login');
  const alternative=await c.newPage();
  await writeFile(join(directory,'desjardins','login-control.json'),JSON.stringify({blocked:true,reason:'login-incomplete',attemptedAt:new Date(Date.now()-7200000-(scenario==='alternate-dossier'?1000:0)).toISOString()}));
  await alternative.goto(scenario==='alternate-dossier'?origin+dossier:'https://id.desjardins.com'+profilePath+'?state='+scenario);
  if(scenario==='ambiguous-selections'){const another=await c.newPage();await another.goto(origin+dossier);}
  const result=await loginForClaim(original,'desjardins');
  assert.equal(result,scenario==='ambiguous-selections'?'login-incomplete':undefined,scenario);
  assert.equal(choices,scenario==='ambiguous-selections'?0:1,scenario);
  await c.close();
 }
 if(process.platform==='win32') {
  const {savePrivate,loadPrivate}=await import('../apps/worker/dist/private-store.js');
  await savePrivate(join(directory,'desjardins','login.dpapi'),{version:1,insurer:'desjardins',username:'synthetic-user',password:'synthetic-password'});
  await writeFile(join(directory,'desjardins','login-control.json'),JSON.stringify({blocked:false}));
  const c=await browser.newContext({serviceWorkers:'block'}),p=await c.newPage();let passwords=0;
  await c.addCookies([{name:'synthetic-new-auth',value:'synthetic-only',domain:'www.agea-gbim.dsf-dfs.com',path:'/'}]);
  await c.exposeFunction('passwordSent',()=>passwords++);
  await c.route('**/*',r=>{
   const path=new URL(r.request().url()).pathname;
   let body=path==='/login'?'<input id="UserName" type="text"><input id="Password" type="password"><button id="submitButton" type="submit">Login</button><script>document.querySelector("button").onclick=()=>passwordSent().then(()=>location.href='+JSON.stringify(origin+dossier)+')</script>':path===dossier?'<div class="panel-dossier"><div class="panel-body-dossier">ACTIF</div><input type="submit" id="grdListeAdherent_ChoisirButton" value="Choisir" onclick="location.href=&quot;/home&quot;"></div>':path==='/home'?'<a href="'+history+'">Réclamations traitées</a>':'<table class="tableau-donnees"><tr><td>Synthetic</td></tr></table>';
   return r.fulfill({contentType:'text/html; charset=utf-8',body});
  });
  await p.goto('https://id.desjardins.com/login');
  assert.equal(await loginForClaim(p,'desjardins'),undefined);
  assert.equal(passwords,1);
  assert.equal(JSON.parse(await readFile(join(directory,'desjardins','login-control.json'),'utf8')).blocked,false);
  assert.ok((await loadPrivate(join(directory,'desjardins','auth-state.dpapi'))).cookies.some(x=>x.name==='synthetic-new-auth'));
  assert.equal(await loginForClaim(p,'desjardins'),undefined);assert.equal(passwords,1);
  await c.close();
 }

 const {tryPortalLogin}=await import('../apps/worker/dist/portal-login.js');
 await writeFile(join(directory,'desjardins','login-control.json'),JSON.stringify({blocked:false}));
 const diagnosticContext=await browser.newContext({serviceWorkers:'block'}),diagnosticPage=await diagnosticContext.newPage();let challenge=true;
 await diagnosticContext.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<input id="Password" type="password">'+(challenge?'<p>Enter verification code</p>':'')}));
 await diagnosticPage.goto('https://id.desjardins.com/login?state=synthetic-private-state');
 assert.equal(await tryPortalLogin(diagnosticPage,'desjardins',async()=>false),'human-required');
 const failureFile=join(directory,'desjardins','login-failure-diagnostic.json');
 const originalFailure=await readFile(failureFile,'utf8');
 assert.ok(!originalFailure.includes('synthetic-private-state'));assert.ok(!originalFailure.includes('https://'));
 challenge=false;await diagnosticPage.reload();
 assert.equal(await tryPortalLogin(diagnosticPage,'desjardins',async()=>false),'human-required');
 assert.equal(await readFile(failureFile,'utf8'),originalFailure,'Blocked checks retain original landing evidence');
 assert.equal(JSON.parse(await readFile(join(directory,'desjardins','login-diagnostic.json'),'utf8')).phase,'retry-blocked');
 await diagnosticContext.close();
 console.log(JSON.stringify({passed:process.platform === 'win32' ? 26 : 24,coverage:'shared dossier continuation, guarded choices, exact authentication evidence, session persistence, single fresh login and reuse',insurerContact:false}));
} finally {await browser.close();await rm(directory,{recursive:true,force:true});}
