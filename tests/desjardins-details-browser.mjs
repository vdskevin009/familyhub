/** Observed French fields and conditional coordination, synthetic portal only. */
import assert from 'node:assert/strict';import {chromium} from 'playwright';
import {mkdtemp,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {dossier,receipt} from './fixtures/desjardins-receipt.mjs';import {receiptPdf} from './fixtures/detailed-receipt.mjs';
const dir=await mkdtemp(join(tmpdir(),'familyhub-desjardins-details-'));process.env.FAMILYHUB_WORKER_DATA=dir;
const {openClaimBrowser,prepareCurrentClaimStep,closeClaimBrowser}=await import('../apps/worker/dist/claim-browser.js');
const {confirmBlueCrossClaimCause}=await import('../apps/worker/dist/bluecross-claim-cause.js');
const {confirmedGovernmentReimbursement,confirmGovernmentReimbursement}=await import('../apps/worker/dist/claim-coordination-answers.js');
const {checkedField}=await import('../apps/worker/dist/claim-field-verification.js');
const url='https://www.agea-gbim.dsf-dfs.com/AGEA-GBIM/Reclamation/DetailFrais_ExpenseDetail.aspx';let session;
const radio=(name,values)=>values.map(([id,text])=>`<span class="dsd-radio"><input type="radio" name="${name}" id="${id}" onkeydown="if(event.code===&#39;Space&#39;){event.preventDefault();setTimeout(()=>{this.checked=true;this.dispatchEvent(new Event(&#39;change&#39;,{bubbles:true}))},120)}" ${id==='other-yes'?'onchange="document.getElementById(\'dependent\').style.display=\'block\'"':''}><label onclick="event.preventDefault()" for="${id}">*${text}(facultatif)</label></span>`).join('');
try{
 for(const scenario of ['no-default','confirmed','wrong-mask','ambiguous-service']){
  if(scenario==='confirmed'){
   await confirmBlueCrossClaimCause({confirmed:true,allInvoices:true,expectedRevision:0,value:'unrelated'});
   const before=await confirmedGovernmentReimbursement(dossier);await confirmGovernmentReimbursement(dossier,{confirmed:true,allPhysiotherapy:true,expectedScope:before.defaultScope,expectedRevision:0,value:'no'});
  }
  let page;const launch=async()=>{const browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined}),original=browser.newContext.bind(browser);
   browser.newContext=async()=>{const c=await original({serviceWorkers:'block'});c.on('page',p=>page=p);await c.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<style>.dsd-radio{display:block;position:relative}.dsd-radio input{position:absolute;top:0;left:0;width:16px;height:16px}.dsd-radio label{display:block;position:relative;background:white;cursor:pointer}</style><main><h1>Frais de soins professionnels</h1><label>*Date des frais(facultatif)<input id="date"></label><p>'+(scenario==='wrong-mask'?'MM-JJ-AAAA':'JJ-MM-AAAA')+'</p><label>*Type de frais(facultatif)<select name="typeFrais" id="service"><option value="">Choisir</option><option value="follow">Traitement subséquent</option>'+(scenario==='ambiguous-service'?'<option value="duplicate">Traitement subséquent</option>':'')+'</select></label><label>*Coût du produit ou du service(facultatif)<input name="montantService" id="amount" inputmode="decimal"></label>'+radio('radioAccident',[['accident-yes','Oui'],['accident-no','Non']])+radio('radioRemboursementObtenu',[['other-yes','Oui'],['other-no','Non']])+radio('radioRemboursement',[['deposit','Par dépôt direct dans votre compte'],['provider','Directement auprès du fournisseur']])+'<div id="dependent" style="display:none">'+radio('radioRemboursementGouvernement',[['government-yes','Oui'],['government-no','Non']])+radio('radioRemboursementPrive',[['private-yes','Oui'],['private-no','Non']])+'<label>New insurer detail<input id="unknown-detail"></label></div><input type="checkbox" aria-label="Final consent"><button onclick="window.next=true">Continuer</button><button onclick="window.sent=true">Confirmer</button></main>'}));return c;};return browser;};
  session=(await openClaimBrowser({...dossier,expenseId:'details-'+scenario,portalUrl:url,preparationUrl:url},false,false,launch,true,async()=>undefined)).sessionId;
  const result=await prepareCurrentClaimStep(session,async()=>({name:'synthetic.pdf',bytes:receiptPdf(receipt)}));
  assert.equal(await page.locator('#date').inputValue(),scenario==='wrong-mask'?'':'12-01-2026',scenario);
  assert.equal(await page.locator('#amount').inputValue(),'120,00',scenario);
  assert.equal(await page.locator('#accident-no').isChecked(),scenario!=='no-default',scenario);
  assert.equal(await page.locator('#other-yes').isChecked(),true,scenario);assert.equal(await page.locator('#deposit').isChecked(),true,scenario);
  assert.equal(await page.locator('#private-yes').isChecked(),true,scenario);assert.equal(await page.locator('#government-no').isChecked(),scenario!=='no-default',scenario);
  assert.equal(await page.locator('#service').inputValue(),scenario==='ambiguous-service'?'':'follow',scenario);
  assert.equal(await page.locator('#unknown-detail').inputValue(),'');assert.ok(result.step.fields.some(f=>!f.kind));
  assert.ok(result.verification.fields.every(f=>f.status==='match'));assert.equal(await page.evaluate(()=>!!window.next||!!window.sent),false);assert.equal(await page.getByLabel('Final consent').isChecked(),false);
  await closeClaimBrowser(session);session=undefined;
 }
 const field={key:'amount',label:'Montant',kind:'originalAmount',type:'text',value:'105,00'};
 assert.equal(checkedField(field,{value:'105,00',signatureMatches:true},true).status,'mismatch');
 assert.equal(checkedField({...field,format:'decimal-comma'},{value:'105.00',signatureMatches:true},true).status,'match');
 assert.equal(checkedField({...field,format:'decimal-comma'},{value:'1,050',signatureMatches:true},true).status,'mismatch');
 console.log(JSON.stringify({passed:7,insurerContact:false,claimSubmitted:false}));
}finally{if(session)await closeClaimBrowser(session);await rm(dir,{recursive:true,force:true});}
