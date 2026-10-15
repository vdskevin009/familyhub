/** Synthetic observed navigation only; every external request intercepted. */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {openBlueCrossClaimEntry} from '../apps/worker/dist/bluecross-claim-navigation.js';
const browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined});
const entry='<div class="caresnet-link"><div class="quick-nav__item--claim" onclick="window.clicked++;location.href=\'/member/login/\'">SUBMIT<br>CLAIMS<br>&amp; FORMS</div></div>';
try{
 const scenarios=['observed','hidden-copy','alternate-wrapper','ambiguous','ambiguous-text','ambiguous-mixed','foreign','form-submit'];
 for(const scenario of scenarios){
  const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();let navigations=0;
  await context.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.pathname==='/member/login/'){navigations++;return route.fulfill({contentType:'text/html',body:'<input type="password"><button>Login</button>'})}
   const notice='<div id="notice">Go digital to avoid mail delays<div class="message-modal__close-button" onclick="window.closedNotice++;document.getElementById(\'notice\').remove()">Close</div></div>';
   const semantic='<a href="/member/login/" onclick="window.clicked++"><span>Submit Claims &amp; Forms</span></a>';
   const body=scenario==='observed'?notice+entry:scenario==='hidden-copy'?'<div hidden>'+entry+'</div>'+entry
    :scenario==='alternate-wrapper'?semantic:scenario==='ambiguous-text'?semantic+semantic:scenario==='ambiguous-mixed'?entry+semantic:scenario==='ambiguous'?entry+entry:entry;
   return route.fulfill({contentType:'text/html',body:`<script>window.clicked=0;window.closedNotice=0</script>${body}<button onclick="window.submitted=true">Submit</button><button onclick="window.next=true">Next</button><input type="checkbox" aria-label="Attestation">`});
  });
  const url=scenario==='foreign'?'https://unexpected.test/member/':scenario==='form-submit'?'https://service.pac.bluecross.ca/ACESWeb/Pages/Claims/eClaim.aspx':'https://service.pac.bluecross.ca/member/';
  await page.goto(url);const result=await openBlueCrossClaimEntry(page);
  const navigated=['observed','hidden-copy','alternate-wrapper'].includes(scenario);
  assert.equal(result,navigated,scenario);assert.equal(navigations,navigated?1:0);
  if(navigated){assert.equal(new URL(page.url()).pathname,'/member/login/');assert.equal(await page.locator('input[type=password]').inputValue(),'')}
  else{assert.equal(await page.evaluate(()=>window.clicked),0);assert.equal(await page.evaluate(()=>window.closedNotice),0);assert.equal(await page.evaluate(()=>window.submitted||window.next||false),false);assert.equal(await page.getByLabel('Attestation').isChecked(),false)}
  await context.close();
 }
 console.log(JSON.stringify({passed:scenarios.length,scenarios,insurerContact:false}));
}finally{await browser.close()}
