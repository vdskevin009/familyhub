import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {claimPortalDiagnostic} from '../apps/worker/dist/claim-portal-diagnostic.js';
const browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined});
try {
 const context=await browser.newContext({serviceWorkers:'block'});
 await context.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<h1>Claim</h1><label>Amount<input id="amount" value="100"></label><input type="hidden" value="hidden-private-token"><input type="password" value="password-private-token" style="display:none"><a href="/AGEA-GBIM/Reclamation/PersonneAssuree_InsuredPerson.aspx?token=query-private-token">Continue</a>'}));
 const page=await context.newPage();await page.goto('https://www.agea-gbim.dsf-dfs.com/AGEA-GBIM/Reclamation/TypeReclamation_TypeOfClaim.aspx?token=query-private-token');
 const diagnostic=await claimPortalDiagnostic(page);assert.equal(diagnostic.tabs[0].kind,'claim');assert.ok(diagnostic.tabs[0].controls.some(c=>c.id==='amount'));
 assert.ok(!JSON.stringify(diagnostic).includes('private-token'));assert.equal(diagnostic.submitAllowed,false);
 await page.goto('https://id.desjardins.com/login?state=query-private-token');const login=await claimPortalDiagnostic(page);assert.equal(login.tabs[0].kind,'login');assert.equal(login.tabs[0].controls,undefined);
 await page.goto('https://untrusted.invalid/AGEA-GBIM/Reclamation/TypeReclamation_TypeOfClaim.aspx');assert.deepEqual((await claimPortalDiagnostic(page)).tabs,[{kind:'other'}]);
 console.log(JSON.stringify({passed:3,insurerContact:false}));
} finally {await browser.close();}
