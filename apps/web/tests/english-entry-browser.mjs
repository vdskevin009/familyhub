// Run against the built PWA with disposable storage and no live network.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { chromium } from "playwright";
const root=resolve("apps/web/dist"), server=createServer(async(req,res)=>{
  const u=new URL(req.url,"http://localhost"), file=resolve(root,"."+u.pathname.replace(/^\/familyhub/,"")+(u.pathname.endsWith("/")?"index.html":""));
  if (!u.pathname.startsWith("/familyhub/")||!file.startsWith(root+sep)) return res.writeHead(404).end();
  try {const data=await readFile(file);res.setHeader("Content-Type",({".js":"text/javascript",".html":"text/html; charset=utf-8",".css":"text/css",".png":"image/png",".json":"application/json",".webmanifest":"application/manifest+json",".svg":"image/svg+xml"})[extname(file)]||"application/octet-stream");res.end(data)} catch{res.writeHead(404).end()}
});
server.listen(0,"127.0.0.1");await once(server,"listening");
const origin="http://127.0.0.1:"+server.address().port,base=origin+"/familyhub/";
const pages = {
  today: "Today", reimbursements: "Claims", finances: "Finances", projects: "Projects", other: "More",
  contributions: "Finances", groceries: "Groceries", mortgage: "Mortgage", property: "Property search",
  vehicle: "Vehicles", documents: "Invoices", invoices: "Invoices", desjardins: "Desjardins", "blue-cross": "Blue Cross",
  notifications: "Notifications", inbox: "Important mail", plan: "Plan", money: "Money",
  more: "Settings and tools", savings: "Recurring expenses"
};
// Known former UI labels, not a generic detector: source names/evidence are never translated.
const french=/Aujourd[’']hui|Remboursements|Récurrents|[Éé]chéance|[Pp]rochaine action|[Éé]conomies|Associez|Hypoth[èe]que|[Rr][ée]glages|V[ée]hicule|[Vv][ée]rifi(?:er|ez)|[Aa]ctualis(?:er|ez)|[Cc]hargement|indisponible|À traiter|Navigation principale|[Ff]ermer|[Oo]uvrir|[Vv]oir les|[Aa]ucune?|D[ée]penses|[Ss]ources documentaires|\b(?:REER|REEE|Compte|Comptes|Ajouter|Disponible)\b|[Cc]liquez|[Cc]onnectez|[Àà] confirmer|l[’']annonce/u;
const errors=[],output=resolve("artifacts/english");await mkdir(output,{recursive:true});let browser;
try {
 browser=await chromium.launch({headless:true,channel:process.env.FAMILYHUB_TEST_BROWSER_CHANNEL||undefined});
 for(const [width,locale] of [[320,"en-CA"],[320,"fr-CA"],[390,"en-CA"],[390,"fr-CA"],[1280,"fr-CA"]]){
   const ctx=await browser.newContext({viewport:{width,height:850},locale,serviceWorkers:"block",reducedMotion:"reduce"});
   await ctx.route("**/*",r=>new URL(r.request().url()).origin===origin?r.continue():r.abort("connectionfailed"));
   const p=await ctx.newPage();p.setDefaultTimeout(7000);p.on("pageerror",e=>errors.push(e.message));await p.goto(base);
   assert.equal(await p.locator("html").getAttribute("lang"),"en-CA");await p.getByRole("heading",{name:"Today",exact:true}).waitFor();
   const nav=p.getByRole("navigation",{name:width<800?"Mobile navigation":"Main navigation",exact:true});
   for(const name of ["Today","Reimbursements","Finances","Projects","More"])assert.equal(await nav.getByRole("button",{name,exact:true}).isVisible(),true,name);
   await nav.getByRole("button",{name:"Projects"}).click();await p.getByRole("button",{name:"Groceries",exact:true}).click();await p.getByRole("heading",{name:"Groceries",exact:true}).waitFor();
   for(const [view,heading] of Object.entries(pages)){console.log(locale,width,view);await p.goto(base+"?view="+view);await p.locator("main").getByRole("heading",{name:heading,exact:true,level:1}).waitFor();
     if(["documents","invoices","desjardins","blue-cross"].includes(view)) {
       const sourceNav=p.getByRole("navigation",{name:"Document sources",exact:true});
       for(const name of ["Invoices","Desjardins","Blue Cross"]) assert.equal(await sourceNav.getByRole("button",{name,exact:true}).count(),1);
     }
     if(view==="contributions") await p.getByRole("heading",{name:"Contributions",exact:true}).waitFor();
     if(view==="groceries") assert.equal(await p.getByRole("button",{name:"Purchases",exact:true}).isVisible(),true);

     const text=await p.locator("main").evaluate(el=>[el.innerText,...[...el.querySelectorAll("[aria-label],[title],[alt],[placeholder]")].flatMap(n=>["aria-label","title","alt","placeholder"].map(k=>n.getAttribute(k)||""))].join("\n"));
     assert.equal(text.match(french)?.[0],undefined,view+" "+locale+" "+width+": "+text.match(french)?.[0]);
     if(["projects","contributions","notifications"].includes(view))await p.screenshot({path:resolve(output,view+"-"+locale+"-"+width+".png")});
   }
   await p.evaluate(()=>localStorage.setItem("familyhub.worker.v1",JSON.stringify({Endpoint:"https://synthetic-worker.invalid",ApiKey:"fixture-only"})));
   await p.goto(base+"?view=property");await p.getByRole("alert").filter({hasText:/Properties unavailable|Check the PC|Cannot reach|Fetch|network|connection/i}).waitFor();await ctx.close();
 }
 assert.deepEqual(errors,[]);console.log("PASS: 20 PWA routes, English nav, Claims, document sources, Contributions and groceries at 320/390 px in en-CA and fr-CA, and 1280 px in fr-CA.");
}finally{await browser?.close();server.close()}
