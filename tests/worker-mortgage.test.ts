import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:net";
import { once } from "node:events";
import { snapshot, quote, assumptions } from "./mortgage-fixture";
test("real isolated worker HTTP: pairing/origin, size, durable writes/restarts, conflicts and private data isolation",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"familyhub-mortgage-api-")), reservation=createServer();reservation.listen(0,"127.0.0.1");await once(reservation,"listening");const port=(reservation.address() as {port:number}).port;await new Promise<void>(r=>reservation.close(()=>r()));
  await writeFile(join(dir,"pairing-key.txt"),"synthetic-mortgage-key");await writeFile(join(dir,"unrelated-sentinel.json"),'{"preserve":true}');
  const headers={"x-familyhub-key":"synthetic-mortgage-key",Origin:"https://vdskevin009.github.io","content-type":"application/json"};
  const call=(path:string,init:RequestInit={})=>fetch(`http://127.0.0.1:${port}${path}`,init),post=(path:string,value:unknown)=>call(path,{method:"POST",headers,body:JSON.stringify(value)});
  let child:ReturnType<typeof spawn>|undefined,logs="";
  async function start(){child=spawn(process.execPath,[process.env.FAMILYHUB_TEST_WORKER_ENTRY || "apps/worker/dist/index.js"],{env:{...process.env,FAMILYHUB_WORKER_HOST:"127.0.0.1",FAMILYHUB_WORKER_PORT:String(port),FAMILYHUB_WORKER_DATA:dir},windowsHide:true,stdio:["ignore","pipe","pipe"]});child.stdout?.on("data",d=>logs+=d);child.stderr?.on("data",d=>logs+=d);for(let n=0;n<100;n++){try{if((await call("/mortgage",{headers})).ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error("Test worker not ready: "+logs);}
  async function stop(){if(child){const ended=once(child,"exit");child.kill();await ended;child=undefined;}}
  try {
    await start();for(const method of ["GET","POST"]){assert.equal((await call("/mortgage",{method})).status,401);assert.equal((await call("/mortgage",{method,headers:{...headers,Origin:"https://evil.test"}})).status,403);}
    const read=await call("/mortgage",{headers});assert.equal(read.headers.get("cache-control"),"no-store");assert.equal((await read.json()).snapshots.length,0);
    const cli=promisify(execFile),keyFile=join(dir,"pairing-key.txt"),inputFile=join(dir,"fixture.json"),endpoint=`http://127.0.0.1:${port}`;
    const preflight=await cli(process.execPath,["scripts/mortgage-ingest.mjs","--preflight","--endpoint",endpoint,"--key-file",keyFile],{windowsHide:true,timeout:15000});assert.equal(JSON.parse(preflight.stdout).readOnly,true);assert.ok(!preflight.stdout.includes("synthetic-mortgage-key"));
    await writeFile(inputFile,JSON.stringify(snapshot()));const validation=await cli(process.execPath,["scripts/mortgage-ingest.mjs","--kind","snapshot","--file",inputFile],{windowsHide:true,timeout:15000});assert.ok(validation.stdout.includes("No write"));assert.equal((await (await call("/mortgage",{headers})).json()).snapshots.length,0);
    let r=await post("/mortgage/snapshots",snapshot());assert.equal(r.status,200);assert.equal((await r.json()).duplicate,false);r=await post("/mortgage/snapshots",snapshot());assert.equal((await r.json()).duplicate,true);
    const conflict=snapshot();conflict.observations[1].rate=3;assert.equal((await post("/mortgage/snapshots",conflict)).status,409);
    const repeated=await cli(process.execPath,["scripts/mortgage-ingest.mjs","--kind","snapshot","--file",inputFile,"--apply","--endpoint",endpoint,"--key-file",keyFile],{windowsHide:true,timeout:15000});assert.ok(repeated.stdout.includes("Already stored"));assert.ok(!repeated.stdout.includes("synthetic-mortgage-key"));
    assert.equal((await post("/mortgage/snapshots",{...snapshot(),padding:"x".repeat(33000)})).status,400);
    for(const v of ["fixed","adjustable-payment","fixed-payment"] as const)assert.equal((await post("/mortgage/quotes",quote(v))).status,200);
    assert.equal((await post("/mortgage/assumptions",assumptions())).status,200);
    assert.equal((await post("/mortgage/assumptions",{...assumptions(),principal:0})).status,400);
    const partial=snapshot("partial","2026-10-21T02:00:00Z");partial.status="partial";partial.observations[3]={product:"variable-5",status:"unavailable",rate:null,lender:null,reason:"Interrupted",eligibility:["Unknown"]};assert.equal((await post("/mortgage/snapshots",partial)).status,200);
    await stop();await start();const state=await (await call("/mortgage",{headers})).json();assert.equal(state.baselineSnapshotId,"synthetic-1");assert.equal(state.snapshots.length,2);assert.equal(state.quotes.length,3);assert.equal(await readFile(join(dir,"unrelated-sentinel.json"),"utf8"),'{"preserve":true}');
  } finally {await stop();}
});
