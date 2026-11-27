/** Isolated static UI; paired requests intercepted. No real model, worker, source or Push. */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {readFile,mkdir,writeFile,mkdtemp} from 'node:fs/promises';
import {resolve,extname,sep,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {projectEvidence,changedEvidence,projectSnapshot,projectNow} from '../../../tests/project-notification-fixture.mjs';
const baseline=process.env.FAMILYHUB_PROJECT_NOTICE_BASELINE==='1';
const source=resolve(process.env.FAMILYHUB_PROJECT_PREVIEW_DIR||'.');
const {NotificationLibrary,notificationClientSnapshot}=await import(pathToFileURL(join(source,'apps/worker/dist/notification-library.js')).href);
const root=join(source,'apps/web/dist'),out=resolve('output/playwright/project-notices');await mkdir(out,{recursive:true});
const server=createServer(async(req,res)=>{const name=new URL(req.url,'http://localhost').pathname.replace(/^\/familyhub/,'');const file=resolve(root,'.'+(name.endsWith('/')?name+'index.html':name));if(!file.startsWith(root+sep))return res.writeHead(403).end();try{res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'})[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}});
server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port+'/familyhub/',api='https://synthetic-worker.invalid';
const errors=[],external=[],writes=[],results=[];let browser;let pushes=0;
try{
 browser=await chromium.launch({headless:true});
 for(const width of (baseline?[390]:[320,390,768,1440])){
  const dir=await mkdtemp(join(out,'synthetic-data-')),lib=new NotificationLibrary(join(dir,'history.json'),async()=>null,async()=>{pushes++;return 'accepted';});
  const initial={vehicle:projectEvidence(),property:projectEvidence('property',1500000)},current={vehicle:changedEvidence(),property:changedEvidence('property',1475000)};
  await lib.scan({projects:initial},[],projectNow);await lib.scan({projects:current},[],projectNow);const saved=await lib.read();assert.equal(saved.events.length,baseline?0:2);
  const original=JSON.stringify(current);let unavailable=false,empty=false,legacyWorker=false;
  const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block',reducedMotion:'reduce'});const page=await context.newPage();await page.clock.install({time:projectNow});page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
  await context.addInitScript(endpoint=>localStorage.setItem('familyhub.worker.v1',JSON.stringify({Endpoint:endpoint,ApiKey:'synthetic-only'})),api);
  await context.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());if(url.origin===new URL(base).origin)return route.continue();if(url.origin!==api){external.push(url.origin);return route.abort();}
   const reply=(body,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'Access-Control-Allow-Origin':new URL(base).origin,'Access-Control-Allow-Headers':'content-type,x-familyhub-key'},body:JSON.stringify(body)});
   if(req.method()==='POST'){writes.push(url.pathname);assert.equal(url.pathname,'/notifications');const body=req.postDataJSON();assert.ok(['read','resolve','dismiss','snooze','restore'].includes(body.action));assert.equal(url.searchParams.get('projectPrices'),'1');return reply(notificationClientSnapshot(await lib.mutate(body,projectNow),true));}
   assert.ok(['GET','OPTIONS'].includes(req.method()));if(req.method()==='OPTIONS')return reply({});
   if(url.pathname==='/notifications'){if(unavailable)return reply({error:'Synthetic unavailable'},503);if(!baseline)assert.equal(url.searchParams.get('projectPrices'),'1');const value=await lib.read();if(legacyWorker){delete value.projectPricesSupported;value.events=value.events.filter(e=>e.kind!=="project-price");}return reply(empty?{...value,events:[]}:value);}
   if(url.pathname==='/vehicle-project')return reply(projectSnapshot('vehicle',current.vehicle));
   if(url.pathname==='/property-project')return reply(projectSnapshot('property',current.property));
   return reply(url.pathname==='/health'?{status:'ok',version:'2.24.0',capabilities:[]}:{});
  });
  async function fits(){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth||[...document.querySelectorAll('dialog[open]')].some(e=>e.scrollWidth>e.clientWidth+1)),false);}
  async function notices(){await page.goto(base+'?view=notifications');await page.getByRole('heading',{name:'Notifications',exact:true}).waitFor();await page.getByRole('button',{name:'Actualiser',exact:true}).waitFor();}
  await notices();
  if(baseline){await page.getByText('Rien de nouveau à traiter',{exact:true}).waitFor();await page.screenshot({path:join(out,'before-notifications-390.png'),fullPage:true});
   for(const kind of ['vehicle','property']){await page.goto(base+'?view='+kind);const name=kind==='vehicle'?'Véhicule fictif A':'100, rue Fictive';await page.getByRole('button',{name,exact:true}).click();await page.getByRole('dialog',{name,exact:true}).waitFor();await page.screenshot({path:join(out,'before-'+kind+'-390.png')});await page.getByRole('dialog').getByRole('heading',{name:kind==='vehicle'?'Historique et inspection':'Historique',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:join(out,'before-history-'+kind+'-390.png')});}
   results.push({width,existingNotificationEvents:0,changesRemainInProjectHistory:true});await context.close();continue;
  }
  await page.locator('article[data-kind="project-price"]').nth(1).waitFor();await fits();await page.screenshot({path:join(out,'after-notifications-'+width+'.png'),fullPage:true});if(width===390)await page.screenshot({path:join(out,'after-mobile-390.png')});
  for(const [kind,prefix,name] of [['vehicle','Auto','Véhicule fictif A'],['property','Bien','100, rue Fictive']]){
   const article=page.locator('article[data-kind="project-price"]').filter({has:page.getByRole('heading',{name:new RegExp('^'+prefix+' :')})});
   await article.getByText('Sources et contexte',{exact:true}).click();await article.getByText(/Aucun Push pour cet avis/).waitFor();await fits();
   if(width===390)await page.screenshot({path:join(out,'evidence-'+kind+'-390.png'),fullPage:true});
   const link=article.getByRole('link',{name:'Ouvrir le dossier',exact:true});await link.focus();await page.keyboard.press('Enter');
   await page.getByRole('dialog',{name,exact:true}).waitFor();assert.equal(new URL(page.url()).searchParams.get('record'),'synthetic-'+kind);await fits();
   await page.screenshot({path:join(out,'destination-'+kind+'-'+width+'.png')});await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);await page.waitForFunction(id=>document.activeElement?.id===id,'project-listing-synthetic-'+kind);
   await notices();await page.locator('article[data-kind="project-price"]').nth(1).waitFor();
  }
  const auto=page.locator('article[data-kind="project-price"]').filter({has:page.getByRole('heading',{name:/^Auto :/})});await auto.getByRole('button',{name:'Marquer comme lu',exact:true}).click();await auto.getByText('Lu',{exact:true}).waitFor();await page.reload();await page.locator('article[data-kind="project-price"]').filter({has:page.getByRole('heading',{name:/^Auto :/})}).getByText('Lu',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Préférences',exact:true}).click();const settings=page.getByRole('dialog');await settings.waitFor();assert.equal(await settings.getByRole('checkbox',{name:/annonces suivies/i}).count(),0);await page.keyboard.press('Escape');
  await page.goto(base+'?view=property&record=missing-synthetic');await page.getByText(/Cette annonce est introuvable/).waitFor();assert.equal(await page.getByRole('dialog').count(),0);await fits();await page.screenshot({path:join(out,'missing-'+width+'.png')});
  legacyWorker=true;await notices();await page.getByText('Ce worker ne signale pas les changements de prix Auto/Immobilier. Les dossiers restent consultables.',{exact:true}).waitFor();await fits();if(width===390)await page.screenshot({path:join(out,'old-worker-390.png')});legacyWorker=false;
  empty=true;await notices();await page.getByText('Rien de nouveau à traiter',{exact:true}).waitFor();await fits();if(width===390)await page.screenshot({path:join(out,'empty-390.png')});
  unavailable=true;await page.reload();await page.getByRole('alert').waitFor();await fits();if(width===390)await page.screenshot({path:join(out,'error-390.png')});
  unavailable=false;empty=false;await page.getByRole('button',{name:'Actualiser',exact:true}).click();await page.locator('article[data-kind="project-price"]').nth(1).waitFor();await fits();
  assert.equal(JSON.stringify(current),original);results.push({width,events:2,exactDestinations:true,escapeFocusRestored:true,readPersists:true,missingEmptyErrorRecovery:true});await context.close();console.log('PASS project notices and exact source navigation '+width);
 }
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.equal(pushes,0);assert.ok(writes.every(p=>p==='/notifications'));
 await writeFile(join(out,baseline?'before-result.json':'acceptance.json'),JSON.stringify({baseline,browserVersion:browser.version(),fixtureClock:projectNow.toISOString(),results,errors,external,realPushes:pushes,sourceWrites:0,notificationFixtureWrites:writes.length},null,2));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
