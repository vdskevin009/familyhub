/** Intercepted custom-element selection rendering; no insurer requests. */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const directory=await mkdtemp(join(tmpdir(),'familyhub-profile-render-'));process.env.FAMILYHUB_WORKER_DATA=directory;
const {continueDesjardinsProfileSelection}=await import('../apps/worker/dist/desjardins-profile-selection.js');
const browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined});
try {
 for(const scenario of ['shadow','delayed','unchecked','other-selected']) {
  const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();let submissions=0,reservations=0;
  await context.exposeFunction('submitted',()=>submissions++);
  await context.route('**/*',route=>{
   const profile=new URL(route.request().url()).hostname==='id.desjardins.com';
   const click=scenario==='shadow'?"this.shadowRoot.querySelector('input').checked=true":scenario==='delayed'?'setTimeout(()=>this.checked=true,150)':'';
   const form='<dsd-form aria-label="profil-select"><dsd-select-tile id="approved" onclick="'+click+'">Synthetic approved profile</dsd-select-tile>'+(scenario==='other-selected'?'<dsd-select-tile checked="true"><input type="radio" checked>Another synthetic profile</dsd-select-tile>':'')+'<dsd-button data-testid="primary-button" type="submit" onclick="submitted().then(()=>location.href=&quot;https://www.agea-gbim.dsf-dfs.com/AGEA-GBIM/Default.aspx&quot;)">Continue</dsd-button></dsd-form>'+(scenario==='shadow'?'<script>document.querySelector("#approved").attachShadow({mode:"open"}).innerHTML="<slot></slot><input type=radio>";</script>':'');
   return route.fulfill({contentType:'text/html',body:profile?form:'<h1>Synthetic portal</h1>'});
  });
  await page.goto('https://id.desjardins.com/staticp/gia-externe-gpap-connect/connexion/selection-profil?state=synthetic-'+scenario);
  const expected=['shadow','delayed'].includes(scenario);
  assert.equal(await continueDesjardinsProfileSelection(page,async()=>'Synthetic approved profile',async()=>{reservations++;return true;}),expected,scenario);
  assert.equal(submissions,expected?1:0,scenario);assert.equal(reservations,1);
  assert.equal(await continueDesjardinsProfileSelection(page,async()=>'Synthetic approved profile',async()=>{throw Error('Never replay');}),false);
  await context.close();
 }
 console.log(JSON.stringify({passed:4,coverage:'shadow and delayed checked proof, unchecked and wrong-profile abstention, no replay',insurerContact:false}));
} finally {await browser.close();await rm(directory,{recursive:true,force:true});}