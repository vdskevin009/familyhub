import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, open, rename, unlink, rmdir } from 'node:fs/promises';
import { join } from 'node:path';

import { validateVehicle, vehicleCard, date, text, type VehicleObservation } from "./vehicle-model.js";
export { validateVehicle, vehicleCard } from "./vehicle-model.js";
export class VehicleConflict extends Error {}
function canonical(v: unknown): string { if(Array.isArray(v))return '['+v.map(canonical).join(',')+']'; if(v && typeof v==='object')return '{'+Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>JSON.stringify(k)+':'+canonical(x)).join(',')+'}'; return JSON.stringify(v); }
/** Immutable observations; replay same ID is idempotent, changed content conflicts. */
export class VehicleStore {
  constructor(private directory:string) {}
  async read(now=new Date()) {
    let names:string[]; try {names=await readdir(this.directory);} catch(e) {if((e as NodeJS.ErrnoException).code==='ENOENT')return {observations:[],cards:[],followingHistory:[],followingRevision:0};throw e;}
    const observations:VehicleObservation[]=[];
    for(const name of names.filter(n=>/^observation-[a-f0-9]{64}\.json$/.test(n))) observations.push(validateVehicle(JSON.parse(await readFile(join(this.directory,name),'utf8'))));
    observations.sort((a,b)=>Date.parse(a.observedAt)-Date.parse(b.observedAt)||a.id.localeCompare(b.id));
    const latest=new Map<string,VehicleObservation>(); for(const p of observations) latest.set(p.listingId,p);
    const followingHistory:FollowingDecision[]=[];
    for(const name of names.filter(n=>/^following-[a-f0-9]{64}\.json$/.test(n))) followingHistory.push(validateFollowing(JSON.parse(await readFile(join(this.directory,name),'utf8'))));
    followingHistory.sort((a,b)=>a.revision-b.revision);
    for(let i=0;i<followingHistory.length;i++) if(followingHistory[i].revision!==i+1)throw Error('Following history inconsistent; preserved for review');
    const decisions=new Map<string,FollowingDecision>();for(const decision of followingHistory)decisions.set(decision.listingId,decision);
    const cards=[...latest.values()].map(p=>{
      const history=observations.filter(o=>o.listingId===p.listingId);
      const changes=history.slice(1).flatMap((o,i)=>{
        const prev=history[i];
        const items:{field:string;before:unknown;after:unknown;observationId:string;observedAt:string;sourceUrl:string}[]=[];
        if(o.status!==prev.status) items.push({field:'status',before:prev.status,after:o.status,observationId:o.id,observedAt:o.observedAt,sourceUrl:o.statusEvidence.sourceUrl??o.url});
        if(o.priceCad.value!==prev.priceCad.value)items.push({field:'priceCad',before:prev.priceCad.value,after:o.priceCad.value,observationId:o.id,observedAt:o.observedAt,sourceUrl:o.priceCad.sourceUrl??o.url});
        return items;
      });
      return {...vehicleCard(p,now),followed:decisions.get(p.listingId)?.followed??false,changes};
    });
    return {observations,cards,followingHistory,followingRevision:followingHistory.length};
  }
  async compare(input:unknown,now=new Date()) {
    if(!input||typeof input!=='object')throw Error('Choose two or three listings');
    const ids=(input as {listingIds?:unknown}).listingIds;
    if(!Array.isArray(ids)||ids.length<2||ids.length>3||ids.some(id=>!text(id,160))||new Set(ids).size!==ids.length)throw Error('Choose two or three distinct listings');
    const state=await this.read(now);
    return {comparedAt:now.toISOString(),items:ids.map(id=>{
      const card=state.cards.find(c=>c.listingId===id);if(!card)throw Error('Unknown comparison listing');
      const priced=state.observations.filter(o=>o.listingId===id&&o.priceCad.value!==null);
      const initial=priced[0]?.priceCad.value??null, current=card.priceCad.value;
      return {...card,budgetHeadroomCad:current===null?null:30_000-current,
        askingPriceReductionCad:current===null||initial===null?null:Math.max(0,initial-current),
        realizedSavingsCad:null,negotiatedSavingsCad:null,
        costCoverage:'asking-price-before-tax-only',
        missingCosts:['sales-tax','dealer-fees','insurance','maintenance','financing']};
    })};
  }
  async setFollowing(input:unknown) {
    if(!input || typeof input!=='object')throw Error('Invalid following decision');
    const v=input as {requestId:string;listingId:string;followed:boolean;expectedRevision:number};
    if(!text(v.requestId,160)||!text(v.listingId,160)||typeof v.followed!=='boolean'||!Number.isSafeInteger(v.expectedRevision)||v.expectedRevision<0)throw Error('Invalid following decision');
    await mkdir(this.directory,{recursive:true});const lock=join(this.directory,'following.lock');
    try{await mkdir(lock);}catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')throw new VehicleConflict('Following busy; refresh before retry');throw e;}
    let temp:string|undefined;
    try {
      const state=await this.read();const prior=state.followingHistory.find(d=>d.requestId===v.requestId);
      if(prior){if(prior.listingId!==v.listingId||prior.followed!==v.followed)throw new VehicleConflict('Following request ID conflict');return {duplicate:true,revision:prior.revision};}
      if(state.followingRevision!==v.expectedRevision)throw new VehicleConflict('Following changed; refresh before retry');
      if(!state.cards.some(c=>c.listingId===v.listingId))throw Error('Unknown listing; no following decision saved');
      const decision:FollowingDecision={requestId:v.requestId,listingId:v.listingId,followed:v.followed,revision:state.followingRevision+1,recordedAt:new Date().toISOString()};
      const file=join(this.directory,'following-'+createHash('sha256').update(v.requestId).digest('hex')+'.json');temp=file+'.'+randomUUID()+'.tmp';
      const f=await open(temp,'wx',0o600);try{await f.writeFile(canonical(decision),'utf8');await f.sync();}finally{await f.close();}
      await rename(temp,file);return {duplicate:false,revision:decision.revision};
    }finally{if(temp)await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});await rmdir(lock);}
  }
  async ingest(input:unknown) {
    const p=validateVehicle(input), content=canonical(p);
    await mkdir(this.directory,{recursive:true});
    const file=join(this.directory,'observation-'+createHash('sha256').update(p.id).digest('hex')+'.json'),lock=file+'.lock',temp=file+'.'+randomUUID()+'.tmp';
    try {await mkdir(lock);} catch(e) {if((e as NodeJS.ErrnoException).code==='EEXIST')throw new VehicleConflict('Observation busy; reread before retry');throw e;}
    try {
      try {const old=canonical(JSON.parse(await readFile(file,'utf8'))); if(old!==content)throw new VehicleConflict('Observation ID conflict; existing evidence preserved');return {duplicate:true};} catch(e) {if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
      const f=await open(temp,'wx',0o600);try{await f.writeFile(content,'utf8');await f.sync();}finally{await f.close();}
      await rename(temp,file);return {duplicate:false};
    } finally {await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});await rmdir(lock);}
  }
}

export type FollowingDecision = {requestId:string;listingId:string;followed:boolean;revision:number;recordedAt:string};
function validateFollowing(input:unknown):FollowingDecision {
 if(!input||typeof input!=='object')throw Error('Invalid following history');const d=input as FollowingDecision;
 if(!text(d.requestId,160)||!text(d.listingId,160)||typeof d.followed!=='boolean'||!Number.isSafeInteger(d.revision)||d.revision<1||!date(d.recordedAt))throw Error('Invalid following history');return {requestId:d.requestId,listingId:d.listingId,followed:d.followed,revision:d.revision,recordedAt:d.recordedAt};
}