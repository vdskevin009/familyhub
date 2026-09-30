"""Synthetic-data PWA checks. Never connects to a real worker or mailbox.

Build first. Run `python apps/web/tests/browser_smoke.py --url http://127.0.0.1:4173/familyhub/`.
Requires Playwright and Chromium. --inline uses the same built JS/CSS in set_content
for constrained environments: it does NOT validate navigation/network/service workers.
"""
import argparse
import asyncio
import json
import os
import re
from pathlib import Path
from playwright.async_api import async_playwright, expect

WEB = Path(__file__).resolve().parents[1]
FIXTURE = json.loads((WEB / "tests/fixtures/household.json").read_text())
VIEWS = ["reimbursements", "invoices", "desjardins", "blue-cross", "today", "inbox", "plan", "money", "more", "other"]
INIT = """(() => {
const fixture = FIXTURE_JSON;
const nativeFetch = window.fetch.bind(window);
if (INLINE_MODE) for (const key of ['localStorage','sessionStorage']) {
 const map = new Map(); Object.defineProperty(window,key,{configurable:true,value:{getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k),clear:()=>map.clear()}});
}
localStorage.clear(); sessionStorage.clear();
localStorage.setItem('familyhub.reimbursements.v1',JSON.stringify(fixture.state));
localStorage.setItem('familyhub.worker.v1',JSON.stringify({Endpoint:'https://pwa-fixture.invalid',ApiKey:'synthetic-ui-test-key'}));
const test=window.__pwaTest={fixture,requests:[],delay:200,readDelay:0,failNext:false,falseAck:false,failReads:false};
const reply=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
window.confirm=()=>true;
window.fetch=async(input,options={})=>{
 const url=typeof input==='string'?input:input.url;
 if(!url.includes('pwa-fixture.invalid'))return nativeFetch(input,options);
 const path=new URL(url).pathname, method=options.method||'GET';
 test.requests.push({path,method,body:options.body?JSON.parse(options.body):null});
 if(method==='POST'){
  await new Promise(resolve=>setTimeout(resolve,test.delay));
  if(test.failNext){test.failNext=false;return reply({error:'Synthetic save failure'},500);}
  if(test.falseAck){test.falseAck=false;return reply({saved:false});}
  const body=JSON.parse(options.body||'{}');
  if(path==='/invoices/workflow/status'){
   const item=fixture.snapshot.reconciliations.find(item=>item.ExpenseDocumentId===body.expenseId||item.DocumentIds.includes(body.expenseId));
   if(!item)throw new Error('Unknown fixture expense');
   item.WorkflowStatus=body.status==='automatic'?item.AutomaticWorkflowStatus:body.status;
   item.WorkflowOrigin=body.status==='automatic'?'automatic':'manual';
   item.WorkflowChangedAt='2026-09-30T12:01:00Z';
  } else if(path==='/invoices/matches/manual'){
   fixture.snapshot.unmatchedReimbursements=fixture.snapshot.unmatchedReimbursements.filter(item=>item.DocumentId!==body.reimbursementId);
  } else if(path==='/invoices/unmatched/ignore'){
   const from=body.ignored?'unmatchedReimbursements':'ignoredUnmatchedReimbursements';
   const to=body.ignored?'ignoredUnmatchedReimbursements':'unmatchedReimbursements';
   const item=fixture.snapshot[from].find(item=>item.DocumentId===body.reimbursementId);
   fixture.snapshot[from]=fixture.snapshot[from].filter(item=>item.DocumentId!==body.reimbursementId);
   if(item)fixture.snapshot[to].push(item);
  } else if(path==='/invoices/matches/decision'){
   for(const item of fixture.snapshot.reconciliations)for(const assignment of item.MatchAssignments||[]){
    if(assignment.ReimbursementDocumentId===body.reimbursementId)assignment.Verification=body.decision==='confirmed'?'confirmed-manually':'rejected';
   }
  } else if(path==='/invoices/documents/ignore'){
   for(const item of fixture.snapshot.items)if(body.documentIds.includes(item.Id)){item.IgnoredAt=body.ignored?'2026-09-30T12:01:00Z':undefined;}
  } else throw new Error('Unexpected mutation in synthetic PWA test: '+path);
  return reply({saved:true});
 }
 if(path==='/health')return reply({status:'ok',version:'2.11.0'});
 if(path==='/invoices'){
  if(test.failReads)return reply({error:'Synthetic read failure'},503);
  const snapshot=JSON.parse(JSON.stringify(fixture.snapshot));
  await new Promise(resolve=>setTimeout(resolve,test.readDelay));return reply(snapshot);
 }
 return reply({state:'up-to-date',lastSuccess:'2026-09-30T12:00:00Z',found:23,accounts:[],progress:{}});
};
})();""".replace("FIXTURE_JSON", json.dumps(FIXTURE))


def inline_html(view):
    html = (WEB / "dist/index.html").read_text()
    js = next((WEB / "dist/assets").glob("index-*.js")).read_text()
    css = "\n".join(path.read_text() for path in (WEB / "dist/assets").glob("*.css"))
    html = re.sub(r'<script[^>]*src="[^"]+"[^>]*></script>', '', html)
    html = re.sub(r'<link[^>]*(?:rel="stylesheet"|rel="modulepreload")[^>]*>', '', html)
    shim = f'''const location={{href:"https://pwa.example.invalid/familyhub/?view={view}",search:"?view={view}"}};
const history={{pushState(_a,_b,url){{location.href=String(url);location.search=new URL(url).search;}}}};'''
    return html.replace('</head>', '<style>' + css + '</style></head>').replace('</body>', '<script>' + INIT.replace("INLINE_MODE", "true") + '</script><script type="module">' + shim + js.replace('</script>', '<\\/script>') + '</script></body>')


async def load(context, view, args, errors):
    page = await context.new_page()
    page.set_default_timeout(8000)
    page.on('pageerror', lambda error: errors.append(str(error)))
    if args.inline:
        await page.set_content(inline_html(view))
    else:
        await page.add_init_script(INIT.replace("INLINE_MODE", "false"))
        await page.goto(args.url + ("?view=" + view if view != "reimbursements" else ""), wait_until="networkidle")
    await page.locator('h1').first.wait_for()
    await page.wait_for_timeout(160)
    return page


async def run(args):
    output = Path(args.output); output.mkdir(parents=True, exist_ok=True)
    metrics, errors = [], []
    async with async_playwright() as p:
        executable = args.chromium or ("/usr/bin/chromium" if Path("/usr/bin/chromium").exists() else None)
        browser = await p.chromium.launch(executable_path=executable, headless=True, args=['--no-sandbox'])
        for width, height in [(320, 740), (390, 844), (768, 1024), (1440, 1000)]:
            context = await browser.new_context(viewport={"width": width, "height": height}, service_workers='block')
            for view in VIEWS:
                page = await load(context, view, args, errors)
                overflow = await page.evaluate('document.documentElement.scrollWidth > innerWidth')
                assert not overflow, f"Horizontal overflow: {view} at {width}px"
                assert await page.locator('main h1').count() == 1, f"Expected one page heading: {view}"
                assert not await page.evaluate("__pwaTest.requests.some(request => request.method === 'POST')"), 'Mount started a mutation'
                metric = {"view": view, "width": width, "overflow": overflow}
                if view == 'reimbursements':
                    rect = await page.locator('.expense-card').first.bounding_box()
                    metric.update(first_card_y=rect['y'], first_card_height=rect['height'])
                    if width == 390:
                        assert rect['y'] < 400, 'Too much chrome above the first claim'
                metrics.append(metric)
                print("VIEW", view, width, flush=True)
                await page.screenshot(path=str(output / f'{view}-{width}.png'), full_page=True)
                await page.close()
            await context.close()
        context = await browser.new_context(viewport={"width":390,"height":844}, service_workers='block')
        page = await load(context, 'reimbursements', args, errors)
        print("INTERACTIONS start", flush=True)
        # Advanced filter sheet, keyboard containment, inclusive dates and removable chips.
        await page.get_by_role('button', name='Filters', exact=True).click()
        dialog = page.get_by_role('dialog', name='Filter claims')
        await expect(dialog).to_be_visible()
        await dialog.get_by_label('Start date', exact=True).fill('2026-09-20')
        await dialog.get_by_label('End date', exact=True).fill('2026-09-24')
        for _ in range(22):
            await page.keyboard.press('Tab')
            assert await page.evaluate("document.querySelector('dialog[open]').contains(document.activeElement)"), 'Focus escaped native modal'
        await page.screenshot(path=str(output/'claims-filters-390.png'), full_page=True)
        await dialog.get_by_role('button', name=re.compile('Show .* claims')).click()
        await expect(dialog).not_to_be_visible()
        assert await page.evaluate("document.body.style.overflow") != 'hidden', 'Body remained scroll-locked'
        await expect(page.get_by_role('button', name='Remove filter: From 2026-09-20')).to_be_visible()
        await expect(page.get_by_role('button', name='Remove filter: Through 2026-09-24')).to_be_visible()
        assert await page.locator('.expense-card').count() == 5
        await page.get_by_role('button', name='Remove filter: From 2026-09-20').click()
        await page.get_by_role('searchbox', name='Search claims').fill('Cedar')
        assert await page.locator('.expense-card').count() == 1
        # UI choices survive leaving the view. No data or credential migration.
        await page.get_by_role('button', name='Invoices', exact=True).click()
        await page.get_by_role('button', name='Claims', exact=True).last.click()
        await expect(page.get_by_role('searchbox', name='Search claims')).to_have_value('Cedar')
        await page.get_by_role('button', name='Remove filter: Through 2026-09-24').click()
        await page.get_by_role('button', name='Clear search claims').click()
        await page.locator('.workflow-tabs').get_by_role('button', name=re.compile('^All')).click()
        print("INTERACTIONS filters/navigation passed", flush=True)
        # Two status changes can be queued; the whole screen is not locked and only one read follows.
        await page.evaluate('__pwaTest.requests=[]; __pwaTest.delay=450')
        first = page.locator('[data-claim-id="fixture-case-0"]')
        second = page.locator('[data-claim-id="fixture-case-1"]')
        # Fixtures may use a different case identifier; stable document title is the fallback.
        if not await first.count(): first = page.locator('.expense-card').filter(has=page.get_by_role('heading', name='Maple Wellness', exact=True)).first
        if not await second.count(): second = page.locator('.expense-card').filter(has=page.get_by_role('heading', name='Cedar Health', exact=True)).first
        first_select = first.get_by_role('combobox')
        second_select = second.get_by_role('combobox')
        before_amounts = await first.locator('.expense-amounts').first.inner_text()
        await first_select.select_option('closed')
        await expect(first.locator('.claim-pending')).to_contain_text('Saving')
        await expect(second_select).to_be_enabled()
        await second_select.select_option('ignore')
        await expect(second.locator('.claim-pending')).to_contain_text('Queued')
        await expect(page.locator('.claim-pending')).to_have_count(0)
        await expect(first_select).to_have_value('closed')
        await expect(second_select).to_have_value('ignore')
        assert await first.locator('.expense-amounts').first.inner_text() == before_amounts
        writes = await page.evaluate("__pwaTest.requests.filter(request=>request.method==='POST')")
        reads = await page.evaluate("__pwaTest.requests.filter(request=>request.path==='/invoices'&&request.method==='GET')")
        assert len(writes)==2 and len(reads)==1, (writes, reads)
        print("INTERACTIONS queued changes passed", flush=True)
        # Rejection rolls back the display; no false saved success.
        await page.evaluate('__pwaTest.failNext=true')
        await first_select.select_option('open')
        await expect(page.locator('.claim-pending')).to_have_count(0)
        await expect(first_select).to_have_value('closed')
        await expect(page.get_by_role('alert')).to_contain_text('Synthetic save failure')
        # A saved mutation followed by a read failure is reported accurately.
        await page.evaluate('__pwaTest.failReads=true')
        await first_select.select_option('open')
        await expect(page.locator('.claim-pending')).to_have_count(0)
        await expect(page.get_by_role('alert')).to_contain_text('Saved on the PC')
        await page.evaluate('__pwaTest.failReads=false')
        await page.get_by_role('button', name='Refresh reimbursements', exact=True).click()
        await expect(first_select).to_have_value('open')
        print("INTERACTIONS failure recovery passed", flush=True)
        # Details still expose evidence and real PDF link paths. Escape restores focus.
        await first.get_by_role('button', name='Details', exact=True).click()
        details = page.get_by_role('dialog', name='Maple Wellness')
        await expect(details).to_be_visible()
        await expect(details.get_by_text('Why FamilyHub linked this insurer record', exact=True)).to_be_visible()
        await expect(details.get_by_role('button', name='Confirm match', exact=True)).to_be_visible()
        await page.screenshot(path=str(output/'claim-details-390.png'), full_page=True)
        await page.keyboard.press('Escape')
        await expect(details).not_to_be_visible()
        await expect(first.get_by_role('button', name='Details', exact=True)).to_be_focused()
        # Sources remains user-invoked; showing it must not begin portal collection.
        post_count = await page.evaluate("__pwaTest.requests.filter(request=>request.method==='POST').length")
        await page.get_by_role('button', name='Sources', exact=True).click()
        await expect(page.get_by_role('dialog', name='Sources & sync')).to_be_visible()
        assert await page.evaluate("__pwaTest.requests.filter(request=>request.method==='POST').length") == post_count
        await page.keyboard.press('Escape')
        # Reconciliation candidate search remains keyboard-accessible and explicit.
        await page.get_by_role('button', name=re.compile('^À réconcilier')).click()
        await page.get_by_role('button', name='Search another invoice', exact=True).click()
        search_dialog = page.get_by_role('dialog', name='Search another invoice')
        await expect(search_dialog).to_be_visible()
        await expect(search_dialog.get_by_role('searchbox')).to_be_visible()
        await page.screenshot(path=str(output/'reconcile-search-390.png'), full_page=True)
        await page.keyboard.press('Escape')
        await page.screenshot(path=str(output/'reconcile-390.png'), full_page=True)
        # Library filters retain their deliberately different, exclusive Before boundary.
        await page.get_by_role('button', name='Invoices', exact=True).click()
        await page.get_by_role('button', name='Filters', exact=True).click()
        library_dialog = page.get_by_role('dialog', name='Filter invoices')
        await library_dialog.get_by_label('From', exact=True).fill('2026-09-20')
        await library_dialog.get_by_label('Before', exact=True).fill('2026-09-25')
        await library_dialog.get_by_role('button', name=re.compile('Show .* records')).click()
        assert await page.locator('.library-card').count()==5
        await page.get_by_role('button', name='Remove filter: Before 2026-09-25').click()
        assert await page.locator('.library-card').count()==6
        # Selected navigation is correct for Other child routes.
        await page.get_by_role('button', name='Other', exact=True).click()
        await page.get_by_role('button', name=re.compile('^Plan Meals')).click()
        await expect(page.locator('.bottom-nav button[aria-current="page"]')).to_have_text('Other')
        if not args.inline:
            await page.go_back()
            await expect(page.get_by_role('heading', name='Your household', exact=True)).to_be_visible()
        await context.close()
        await browser.close()
    assert not errors, errors
    report = {"mode": "inline-built-bundle" if args.inline else "http-browser", "viewports": metrics,
              "page_errors": errors, "interaction_suite": "passed", "real_worker_mutations": 0}
    (output/'report.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report,indent=2))

if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--inline', action='store_true')
    parser.add_argument('--url', default='http://127.0.0.1:4173/familyhub/')
    parser.add_argument('--chromium', default=os.getenv('CHROMIUM_PATH'))
    parser.add_argument('--output', default='artifacts/pwa-product')
    asyncio.run(run(parser.parse_args()))
