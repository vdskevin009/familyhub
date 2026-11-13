/** Synthetic fixtures only: all browser requests are intercepted, no insurer contacted. */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
const privateDir = await mkdtemp(join(tmpdir(), 'fh-bc-history-'));
process.env.FAMILYHUB_WORKER_DATA = privateDir;
const { createBlueCrossHistoryNavigation } = await import('../apps/worker/dist/bluecross-history-navigation.js');
const { blueCrossPageCategory } = await import('../apps/worker/dist/bluecross-page-category.js');
const { findPortalHistoryPage } = await import('../apps/worker/dist/portal-history-page.js');
const { tryPortalLogin, submitPortalLogin } = await import('../apps/worker/dist/portal-login.js');
const browser = await chromium.launch({ headless: true, channel: process.platform === 'win32' ? 'msedge' : undefined });
const origin = 'https://service.pac.bluecross.ca';
const historyPath = '/ACESWeb/Pages/Claims/Claims.aspx';
const link = '<a href="#" onclick="event.preventDefault();window.historyClicks++;LOCATION">View more claims</a>';
const notice = '<div class="message-modal" style="position:fixed;inset:0;background:white;z-index:100"><h2>Go digital to avoid mail delays</h2><div class="message-modal__close-button"><button data-test="close-message-btn" onclick="window.noticeClicks++;this.closest(\'.message-modal\').remove()">Close</button></div></div>';
const welcome = notice.replace('<h2>Go digital to avoid mail delays</h2>','<p>Welcome to your Member Profile</p><button data-test="close-welcome-modal">Go to Member Profile</button>');
let passed = 0;
try {
  for (const scenario of ['plain', 'notice', 'notice-aria-hidden', 'welcome', 'welcome-consent', 'welcome-form', 'popup', 'icon-label', 'login-path-home', 'hidden-copy', 'ambiguous', 'ambiguous-notice', 'unknown-modal', 'challenge', 'password', 'password-update', 'email-update', 'security-questions', 'foreign', 'lookalike', 'credentials-url', 'wrong-label', 'uncertain-click', 'notice-and-challenge']) {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    try {
      let historyLoads = 0;
      await context.route('**/*', async route => {
        const u = new URL(route.request().url());
        if (u.pathname === historyPath) { historyLoads++; return route.fulfill({contentType:'text/html; charset=utf-8', body:'<table id="grdClaimsGrid"><tr><td>Synthetic</td></tr></table>'}); }
        const action = scenario === 'uncertain-click' ? '' : scenario === 'popup' ? `window.open('${historyPath}','_blank')` : `location.href='${historyPath}'`;
        let entry = link.replace('LOCATION', action);
        if (scenario === 'icon-label') entry = entry.replace('View more claims', 'View more claims \ue94b');
        if (scenario === 'ambiguous' || scenario === 'ambiguous-notice') entry += entry;
        if (scenario === 'hidden-copy') entry = '<div hidden>'+entry+'</div>'+entry;
        if (scenario === 'wrong-label') entry = entry.replace('View more claims', 'Submit claims history');
        let overlay = ['notice','notice-aria-hidden','ambiguous-notice','notice-and-challenge'].includes(scenario) ? notice
          : scenario === 'unknown-modal' ? notice.replace('Go digital to avoid mail delays','Accept updated terms') : '';
        if(scenario==='welcome')overlay=welcome;
        if(scenario==='welcome-consent')overlay=welcome.replace('Welcome to your Member Profile','I agree to the terms and conditions');
        if(scenario==='welcome-form')overlay=welcome.replace('Welcome to your Member Profile','Update your details<input type="text">');
        if (scenario === 'notice-aria-hidden') {
          entry='<div id="background" aria-hidden="true">'+entry+'</div>';
          overlay=overlay.replace('window.noticeClicks++;','window.noticeClicks++;document.getElementById(\'background\').removeAttribute(\'aria-hidden\');');
        }
        const password = scenario === 'password' ? '<input type="password">' : '';
        const challenge = ['challenge','notice-and-challenge'].includes(scenario) ? '<p>Enter your verification code</p>' : '';
        return route.fulfill({contentType:'text/html; charset=utf-8', body:`<script>window.historyClicks=0;window.noticeClicks=0;window.sensitiveActions=0</script>${entry}${overlay}${password}${challenge}<button onclick="window.sensitiveActions++">Submit claim</button><button onclick="window.sensitiveActions++">Update password</button>`});
      });
      const page = await context.newPage();
      const path = ['password-update','email-update','security-questions'].includes(scenario)
        ? ({'password-update':'/member/update-password','email-update':'/member/update-email','security-questions':'/member/challenge-questions'})[scenario]
        : scenario === 'login-path-home' ? '/member/login/' : '/member/';
      const host = scenario === 'foreign' ? 'https://unexpected.test' : scenario === 'lookalike' ? origin+'.unexpected.test' : scenario === 'credentials-url' ? 'https://synthetic@service.pac.bluecross.ca' : origin;
      await page.goto(host+path);
      const navigate = createBlueCrossHistoryNavigation();
      const expected = ['plain','notice','notice-aria-hidden','welcome','popup','icon-label','login-path-home','hidden-copy','uncertain-click'].includes(scenario);
      let navigated=await navigate(page);
      // Production polls readiness. A rendering-only failed trial may be retried,
      // but a reserved click must never be replayed by this wait.
      const readyDeadline=Date.now()+4000;
      while(expected && !navigated && !navigate.diagnostic().attempted && Date.now()<readyDeadline) {
        await new Promise(resolve=>setTimeout(resolve,20));navigated=await navigate(page);
      }
      assert.equal(navigated, expected, scenario+': '+JSON.stringify(navigate.diagnostic()));
      if (expected && scenario !== 'uncertain-click') {
        // Wait for the synthetic navigation, then apply the real history verifier.
        await assert.doesNotReject(async () => {
          const until = Date.now()+4000;
          while (Date.now()<until) {
            if ((await findPortalHistoryPage(context,page,'bluecross')).page) return;
            await new Promise(resolve=>setTimeout(resolve,20));
          }
          assert.fail('Exact history was not reached: '+scenario);
        });
        assert.equal(historyLoads,1,scenario);
      } else {
        assert.equal(historyLoads,0,scenario);
        assert.equal(await page.evaluate(()=>window.historyClicks), scenario==='uncertain-click'?1:0,scenario);
        assert.equal(await page.evaluate(()=>window.noticeClicks),0,scenario);
        assert.equal(await page.evaluate(()=>window.sensitiveActions),0,scenario);
      }
      assert.equal(await navigate(page),false,'Never repeat uncertain or completed navigation: '+scenario);
      if (scenario==='uncertain-click') assert.equal(await page.evaluate(()=>window.historyClicks),1);
      if (scenario==='uncertain-click') {
        navigate.afterCredentialSubmission(page);
        assert.equal(await navigate(page),false,'Submission signal alone cannot replay an uncertain click');
        assert.equal(await page.evaluate(()=>window.historyClicks),1);
      }
      const diag=navigate.diagnostic();
      assert.deepEqual(Object.keys(diag).sort(),['stage','visibleHistoryControls','knownNoticeVisible','welcomeVisible','visibleModal','attempted'].sort());
      assert.equal(JSON.stringify(diag).includes('https://'),false);
      if(scenario==='unknown-modal')assert.equal(diag.stage,'history-control-obstructed');
      if(scenario==='uncertain-click')assert.equal(diag.attempted,true);
      passed++;
    } finally { await context.close(); }
  }
  // Reproduce the prior collector's observed-overlay failure without contacting the portal.
  const context=await browser.newContext({serviceWorkers:'block'});
  await context.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:link.replace('LOCATION','')+notice}));
  const page=await context.newPage();await page.goto(origin+'/member/');page.setDefaultTimeout(300);
  await assert.rejects(()=>page.getByRole('link',{name:/view more claims|claims history/i}).first().click(),/Timeout/);
  await context.close();passed++;
  for (const mode of ['ordinary','recovery','manual']) {
    const recovery=mode==='recovery';
    const context=await browser.newContext({serviceWorkers:'block'});
    let expiredClicks=0,historyLoads=0,submissions=0;
    await context.route('**/*',async route=>{
      const u=new URL(route.request().url());
      if(u.pathname===historyPath){historyLoads++;return route.fulfill({contentType:'text/html; charset=utf-8',body:'<table id="grdClaimsGrid"><tr><td>Synthetic</td></tr></table>'});}
      if(u.pathname==='/member/login/'){
        expiredClicks++;
        return route.fulfill({contentType:'text/html; charset=utf-8',body:'<form onsubmit="event.preventDefault();location.href=\'/member/?fresh=1\'"><input id="policy" type="text"><input id="certificate" type="text"><input id="password" type="password"><input type="radio" name="spouse" value="0"><button type="submit">Login</button></form>'});
      }
      return route.fulfill({contentType:'text/html; charset=utf-8',body:`<a href="${u.searchParams.has('fresh')?historyPath:'/member/login/'}">View more claims</a>`});
    });
    const page=await context.newPage();await page.goto(origin+'/member/');
    const navigate=createBlueCrossHistoryNavigation(mode==='manual');
    assert.equal(await navigate(page),true);await page.waitForURL(origin+'/member/login/');
    assert.equal(await navigate(page),false);assert.equal(navigate.diagnostic().stage,'returned-to-login');
    const attemptedAt=new Date(Date.now()-31*60_000).toISOString();
    let control=recovery?{blocked:true,reason:'login-incomplete',attemptedAt}:{blocked:false};
    const ready=async()=>{
      if((await findPortalHistoryPage(context,page,'bluecross')).page)return true;
      await navigate(page);
      return !!(await findPortalHistoryPage(context,page,'bluecross')).page;
    };
    const deps={now:Date.now,read:async()=>control,save:async(_,value)=>{control=value;},
      credentials:async()=>({version:1,insurer:'bluecross',policy:'synthetic',certificate:'synthetic',password:'synthetic-password',role:'member'}),
      submit:async(...args)=>{submissions++;return submitPortalLogin(...args);},reserveRecovery:async()=>async()=>{}};
    const request=recovery?{requestId:'11111111-1111-4111-8111-111111111111',expectedAttemptedAt:attemptedAt,acknowledgeUncertainAttempt:true}:undefined;
    if(mode==='manual') {
      // Simulate the operator's completed sign-in in this intercepted context.
      await page.goto(origin+'/member/?fresh=1');assert.equal(await navigate(page),true);
      await page.waitForURL(origin+historyPath);
      assert.equal(submissions,0);
    } else {
      assert.equal(await tryPortalLogin(page,'bluecross',ready,deps,request,()=>page,()=>navigate.afterCredentialSubmission(page)),undefined);
      assert.equal(submissions,1);assert.equal(control.blocked,false);
    }
    assert.equal(expiredClicks,1);assert.equal(historyLoads,1);
    assert.equal(await navigate(page),false);assert.equal(historyLoads,1);
    await context.close();passed++;
  }
  for (const [path,category] of [['/member/','member-home'],['/member/login/','login'],['/member/update-password','password-update'],['/member/challenge-questions','security-questions'],['/member/update-email','email-update'],[historyPath,'claims-history']]) {
    assert.equal(blueCrossPageCategory(origin+path+'?private=DO_NOT_PERSIST'),category);passed++;
  }
  assert.equal(blueCrossPageCategory(origin+'.evil.test/member/'),'other');
  assert.equal(blueCrossPageCategory('https://user:secret@service.pac.bluecross.ca/member/'),'other');
  assert.equal(blueCrossPageCategory(origin+'/private-unknown'),'other-portal-page');
  console.log(JSON.stringify({passed,insurerContact:false,originalOverlayFailureReproduced:true}));
} finally { await browser.close(); await rm(privateDir,{recursive:true,force:true}); }
