import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {claimPortalDiagnostic} from '../apps/worker/dist/claim-portal-diagnostic.js';
const browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined});
try {
 const context=await browser.newContext({serviceWorkers:'block'});
 await context.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<main><h1>Claim</h1><p>Enter the full expense before other-insurer reimbursement.</p><label>Amount<input id="amount" value="100"></label><input type="hidden" value="hidden-private-token"><input type="password" value="password-private-token" style="display:none"><a href="/AGEA-GBIM/Reclamation/PersonneAssuree_InsuredPerson.aspx?token=query-private-token">Continue</a><a id="claim-entry" href="javascript:private_token()">Réclamation en ligne</a></main>'}));
 const page=await context.newPage();await page.goto('https://www.agea-gbim.dsf-dfs.com/AGEA-GBIM/Reclamation/TypeReclamation_TypeOfClaim.aspx?token=query-private-token');
 await page.locator('#amount').evaluate(el=>{el.required=true;el.placeholder='0.00';});
 const diagnostic=await claimPortalDiagnostic(page);assert.equal(diagnostic.tabs[0].kind,'claim');assert.ok(diagnostic.tabs[0].controls.some(c=>c.id==='amount'&&c.required&&c.placeholder==='0.00'));
 assert.ok(!JSON.stringify(diagnostic).includes('private-token'));assert.equal(diagnostic.submitAllowed,false);assert.ok(diagnostic.tabs[0].navigationActions.some(a=>a.kind==='script'));assert.ok(!JSON.stringify(diagnostic).includes('private_token'));assert.ok(diagnostic.tabs[0].visibleInstructions.includes('full expense'));assert.ok(!diagnostic.tabs[0].visibleInstructions.includes('100'));
 await page.goto('https://id.desjardins.com/login?state=query-private-token');const login=await claimPortalDiagnostic(page);assert.equal(login.tabs[0].kind,'login');assert.equal(login.tabs[0].controls,undefined);
 await page.goto('https://untrusted.invalid/AGEA-GBIM/Reclamation/TypeReclamation_TypeOfClaim.aspx');assert.deepEqual((await claimPortalDiagnostic(page)).tabs,[{kind:'other'}]);
 console.log(JSON.stringify({passed:3,insurerContact:false}));
} finally {await browser.close();}
