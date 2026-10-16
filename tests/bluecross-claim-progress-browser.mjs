import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {advanceBlueCrossDetails,advanceBlueCrossExpenses} from '../apps/worker/dist/bluecross-claim-progress.js';
const url='https://service.pac.bluecross.ca/ACESWeb/Pages/Claims/eClaim.aspx';
const dossier={insurer:'blue-cross',blocked:false,fields:{patient:'Kevin',practitioner:'Synthetic Provider',serviceDate:'2026-09-01',originalAmount:100,service:'20 min Chiropractic Return'},attachments:[{documentId:'synthetic',attachmentId:'pdf',name:'synthetic.pdf'}]};
const illness='Owner-described symptom';const browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined});
const scenarios=['details','details-not-ready','details-unknown','summary','wrong-amount','wrong-date','wrong-patient','wrong-benefit','wrong-treatment','wrong-provider','wrong-illness','multiple-rows','multiple-pdfs','blocked','consent','ambiguous-next','changed-next','disabled-next','wrong-origin','uncertain-summary'];
try{
for(const scenario of scenarios){
 const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();let calls=0,reservations=0;await context.exposeFunction('recordNext',()=>calls++);
 const details=scenario.startsWith('details');
 const cells=[scenario==='wrong-patient'?'Jasmine':'Kevin',scenario==='wrong-benefit'?'Massage':'Chiropractor',scenario==='wrong-provider'?'Different Provider':'Synthetic Provider',scenario==='wrong-treatment'?'Initial visit':'Chiropractic - In Person - Subsequent Treatment',scenario==='wrong-date'?'Sep 2, 2026':'Sep 1, 2026',scenario==='wrong-amount'?'$80.00':'$100.00',scenario==='wrong-illness'?'Changed symptom':illness];
 const row='<tr>'+cells.map(x=>'<td>'+x+'</td>').join('')+'</tr>';
 const after=details?'<h1>Your Expenses</h1>':'<h1>Additional Information Required</h1>';
 const next=`<button id="form_StepNavigationTemplateContainerID_StepNextButton" ${scenario==='disabled-next'?'disabled':''} onclick="recordNext();${scenario==='uncertain-summary'?'':'document.body.innerHTML=window.after'}">${scenario==='changed-next'?'Submit':'Next'}</button>`;
 await context.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<script>window.after=${JSON.stringify(after)}</script>`+(details?`<h1>${scenario==='details-unknown'?'Unknown screen':'Claim Details'}</h1><input id="form_txtAmount" value="100.00">`:'<h1>Your Expenses</h1><table id="form_ucClaimExpenseGrid_grdExpenseGrid">'+row+(scenario==='multiple-rows'?row:'')+'</table>')+next+(scenario==='ambiguous-next'?next:'')+(scenario==='consent'?'<input type="checkbox" id="form_ucSubmitClaim_chkConsent">':'')}));
 await page.goto(scenario==='wrong-origin'?'https://foreign.invalid/':url);
 const d={...dossier,blocked:scenario==='blocked',attachments:scenario==='multiple-pdfs'?[...dossier.attachments,...dossier.attachments]:dossier.attachments};
 let result=false;const act=()=>details?advanceBlueCrossDetails(page,scenario!=='details-not-ready',()=>reservations++):advanceBlueCrossExpenses(page,d,illness,()=>reservations++);
 try{result=await act();}catch(error){if(scenario!=='uncertain-summary')throw error;}
 const success=['details','summary'].includes(scenario);assert.equal(result,success,scenario);assert.equal(calls,success||scenario==='uncertain-summary'?1:0,scenario+' clicks');assert.equal(reservations,calls,scenario+' reserve-before-click');
 assert.equal(await page.getByRole('heading',{name:'Additional Information Required',exact:true}).count(),scenario==='summary'?1:0,scenario+' no final submit');
 if(scenario==='uncertain-summary')assert.equal(reservations,1,'Uncertain navigation is reserved for caller latch');
 await context.close();
}
console.log(JSON.stringify({passed:scenarios.length,scenarios,insurerContact:false,consent:false,submission:false}));
}finally{await browser.close();}