/** Synthetic read-only browser test; never reaches the installed worker or external websites. */
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, join, relative, extname } from "node:path";
import { once } from "node:events";
const make=(id,total,sourceType,date,reference="")=>({id,revision:"1",status:"saved",reviewedAt:sourceType==="final-receipt"?date:null,extraction:"complete",createdAt:date+"T12:00:00Z",duplicateOf:null,sources:[],receipt:{store:"PC Express",sourceType,currency:"CAD",date,reference,total,delivery:null,service:null,tip:null,tax:null,discount:null,items:[],warnings:[]}});
const records=[make("a",112,"confirmation","2026-10-24","123456789012345"),make("b",112,"confirmation","2026-10-24","123456789012345"),make("c",90,"final-receipt","2026-11-01"),make("older",20,"final-receipt","2025-09-01")];
const plan={schema:1,revision:"",area:"",areaConfirmed:false,currency:"CAD",tipPerOrder:0,items:[],retailers:[],prices:[]};
let writes=0,fail=false,browser;const errors=[],external=[];
const api=createServer((req,res)=>{res.setHeader("Access-Control-Allow-Origin",req.headers.origin||"*");res.setHeader("Access-Control-Allow-Headers","content-type,x-familyhub-key");if(req.method==="OPTIONS")return res.end();if(req.method!=="GET")writes++;res.setHeader("Content-Type","application/json");if(fail){res.writeHead(503);return res.end('{}');}res.end(JSON.stringify(req.url==="/groceries"?{records}:req.url==="/groceries/planning"?plan:{}));});
const root=resolve("apps/web/dist"),directory=resolve("artifacts/grocery-monthly");
const site=createServer(async(req,res)=>{const path=new URL(req.url,"http://localhost").pathname.replace(/^\/familyhub/,""),file=resolve(root,"."+(path||"/index.html"));if(relative(root,file).startsWith("..")){res.writeHead(403);return res.end();}try{const target=path.endsWith("/")?join(file,"index.html"):file;res.setHeader("Content-Type",({".html":"text/html",".js":"text/javascript",".css":"text/css",".svg":"image/svg+xml"})[extname(target)]||"application/octet-stream");res.end(await readFile(target));}catch{res.writeHead(404);res.end();}});
try{
 api.listen(0,"127.0.0.1");site.listen(0,"127.0.0.1");await Promise.all([once(api,"listening"),once(site,"listening")]);await mkdir(directory,{recursive:true});
 const endpoint=`http://127.0.0.1:${api.address().port}`,base=`http://127.0.0.1:${site.address().port}/familyhub/?view=groceries&tab=catalogue`;
 browser=await chromium.launch({headless:true,channel:process.env.FAMILYHUB_TEST_BROWSER_CHANNEL||"msedge"});
 for(const width of [320,390,768,1280]){
 const context=await browser.newContext({viewport:{width,height:900},reducedMotion:"reduce",serviceWorkers:"block"});
 await context.route("**/*",route=>{if(new URL(route.request().url()).hostname!=="127.0.0.1"){external.push(route.request().url());return route.abort();}return route.continue();});
 await context.addInitScript(({endpoint})=>localStorage.setItem("familyhub.worker.v1",JSON.stringify({Endpoint:endpoint,ApiKey:"synthetic"})),{endpoint});
 const page=await context.newPage();page.setDefaultTimeout(10000);page.on("pageerror",e=>errors.push(e.message));await page.goto(base);
 const chart=page.getByRole("region",{name:"Dépenses mensuelles PC Express",exact:true});await chart.getByText(/112,00/).first().waitFor();
 assert.equal(new URL(page.url()).searchParams.get("tab"),"tickets");assert.equal(await page.getByRole("button",{name:"Catalogue",exact:true}).count(),0);assert.equal(await page.getByRole("button",{name:"Moins cher ailleurs",exact:true}).count(),0);
 assert.equal(await page.getByRole("button",{name:"Achats",exact:true}).count(),1);
 await chart.getByText("Montants et commandes par mois · CAD",{exact:true}).click();await chart.getByText(/112,00.*estimés · 1 commande/).waitFor();await chart.getByText(/90,00.*payés · 1 reçu/).waitFor();
 await chart.getByText("Couverture et méthode",{exact:true}).click();await chart.getByText(/1 source\(s\) supplémentaire/).waitFor();await chart.getByText(/pas certifié exhaustif/).waitFor();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.evaluate(()=>document.activeElement?.blur());await page.screenshot({path:join(directory,`monthly-${width}.png`),fullPage:true});
 await chart.getByLabel("Année",{exact:true}).selectOption("2025");await chart.getByText(/20,00/).first().waitFor();await chart.getByLabel("Année",{exact:true}).selectOption("2026");
 const graph=chart.getByRole("region",{name:/Graphique mensuel/});await graph.focus();assert.equal(await graph.evaluate(el=>document.activeElement===el),true);
 fail=true;await page.reload();await page.getByText(/Historique en cache/).waitFor();await chart.getByText(/Données en cache/).waitFor();fail=false;
 for (const oldTab of ["target", "needs", "compare"]) { await page.goto(base.replace("tab=catalogue", "tab=" + oldTab)); await chart.getByText(/112,00/).first().waitFor(); assert.equal(new URL(page.url()).searchParams.get("tab"), "tickets"); assert.equal(await page.getByRole("button", { name: "Catalogue", exact: true }).count(), 0); }
 await context.close();console.log(`PASS monthly chart, dedup, paid/estimate separation, coverage, year control, removed tabs, cache and no overflow at ${width}px`);
 }
 assert.equal(writes,0);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
}finally{await browser?.close();await Promise.all([new Promise(r=>api.close(r)),new Promise(r=>site.close(r))]);}
