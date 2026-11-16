import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, open, rename, unlink, rmdir } from 'node:fs/promises';
import { join } from 'node:path';

export type Evidence<T> = { value: T | null; sourceUrl: string | null; checkedAt: string | null; note: string };
export type PropertyObservation = {
  id: string; listingId: string; observedAt: string; address: string; url: string;
  status: 'active' | 'sold' | 'withdrawn' | 'unavailable' | 'unknown';
  primaryPhoto?: { url: string; sourceUrl: string; attribution: string; checkedAt: string } | null;
  statusEvidence: Evidence<string>;
  monthlyStrataFeeCad?: Evidence<number>;
  priceCad: Evidence<number>; bedrooms: Evidence<number>; lowerLonsdale: Evidence<boolean>;
  separateEntrances: Evidence<boolean>;
  airbnb: { status: 'unknown' | 'conditional' | 'prohibited'; evidence: { url: string; checkedAt: string; note: string }[] };
};
const date = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v));
function text(v: unknown, max = 1000): v is string { return typeof v === 'string' && v.length > 0 && v.length <= max; }
function url(v: unknown): v is string { try { const u = new URL(String(v)); return typeof v === 'string' && v.length < 2000 && u.protocol === 'https:' && !u.username && !u.password; } catch { return false; } }
function evidence(v: unknown, kind: 'number' | 'boolean' | 'string', at: string): boolean {
  if (!v || typeof v !== 'object') return false;
  const e = v as Evidence<unknown>;
  if (typeof e.note !== 'string' || e.note.length > 1000) return false;
  if (e.value === null) return e.sourceUrl === null && e.checkedAt === null;
  return typeof e.value === kind && (kind !== 'number' || (Number.isFinite(e.value) && Number(e.value) >= 0)) && url(e.sourceUrl) && date(e.checkedAt) && Date.parse(e.checkedAt) <= Date.parse(at);
}
export function validateProperty(input: unknown): PropertyObservation {
  if (!input || typeof input !== 'object') throw Error('Invalid property observation');
  const p = input as PropertyObservation;
  if (!text(p.id, 160) || !text(p.listingId, 160) || !date(p.observedAt) || !text(p.address, 300) || !url(p.url) || !['active','sold','withdrawn','unavailable','unknown'].includes(p.status)) throw Error('Invalid property identity/date');
  if (!evidence(p.statusEvidence,'string',p.observedAt) || (p.status === 'unknown' ? p.statusEvidence.value !== null : p.statusEvidence.value !== p.status)) throw Error('Listing status requires explicit dated source; disappearance is unknown');
  if (!evidence(p.priceCad, 'number', p.observedAt) || !evidence(p.bedrooms, 'number', p.observedAt) || !evidence(p.lowerLonsdale, 'boolean', p.observedAt) || !evidence(p.separateEntrances, 'boolean', p.observedAt)) throw Error('Property facts require dated source evidence');
  if (p.priceCad.value !== null && p.priceCad.value <= 0 || p.bedrooms.value !== null && !Number.isInteger(p.bedrooms.value)) throw Error('Invalid property amount/count');
  if (!p.airbnb || !['unknown','conditional','prohibited'].includes(p.airbnb.status) || !Array.isArray(p.airbnb.evidence) || p.airbnb.evidence.length > 20 || p.airbnb.evidence.some(e => !url(e.url) || !date(e.checkedAt) || Date.parse(e.checkedAt) > Date.parse(p.observedAt) || !text(e.note)) || p.airbnb.status !== 'unknown' && p.airbnb.evidence.length === 0) throw Error('Airbnb assessment requires evidence; no blanket permission');
  if (p.primaryPhoto != null && (!url(p.primaryPhoto.url) || !url(p.primaryPhoto.sourceUrl) || !text(p.primaryPhoto.attribution,300) || !date(p.primaryPhoto.checkedAt) || Date.parse(p.primaryPhoto.checkedAt)>Date.parse(p.observedAt))) throw Error("Invalid attributed listing photo");
  if(p.monthlyStrataFeeCad!==undefined && !evidence(p.monthlyStrataFeeCad,"number",p.observedAt)) throw Error("Strata fees require dated source evidence");
  // Whitelist the payload: never persist arbitrary imported private context.
  const fact = <T>(e: Evidence<T>): Evidence<T> => ({value:e.value,sourceUrl:e.sourceUrl,checkedAt:e.checkedAt,note:e.note});
  return {id:p.id,listingId:p.listingId,observedAt:p.observedAt,address:p.address,url:p.url,status:p.status,statusEvidence:fact(p.statusEvidence),primaryPhoto:p.primaryPhoto == null ? null : {url:p.primaryPhoto.url,sourceUrl:p.primaryPhoto.sourceUrl,attribution:p.primaryPhoto.attribution,checkedAt:p.primaryPhoto.checkedAt},monthlyStrataFeeCad:p.monthlyStrataFeeCad===undefined?{value:null,sourceUrl:null,checkedAt:null,note:"Not collected"}:fact(p.monthlyStrataFeeCad),priceCad:fact(p.priceCad),bedrooms:fact(p.bedrooms),lowerLonsdale:fact(p.lowerLonsdale),separateEntrances:fact(p.separateEntrances),airbnb:{status:p.airbnb.status,evidence:p.airbnb.evidence.map(e=>({url:e.url,checkedAt:e.checkedAt,note:e.note}))}};
}
export function propertyCard(input: unknown, now = new Date()) {
  const p = validateProperty(input);
  const checks = [
    {id:'budget', evidence:p.priceCad, pass:p.priceCad.value === null ? null : p.priceCad.value <= 1_700_000},
    {id:'bedrooms', evidence:p.bedrooms, pass:p.bedrooms.value === null ? null : p.bedrooms.value >= 3},
    {id:'neighbourhood', evidence:p.lowerLonsdale, pass:p.lowerLonsdale.value},
    {id:'entrances', evidence:p.separateEntrances, pass:p.separateEntrances.value}
  ].map(c => ({...c, status:c.pass === null ? 'unknown' : c.pass ? 'pass' : 'fail'}));
  const known = checks.filter(c=>c.pass !== null).length;
  const age = now.getTime() - Date.parse(p.observedAt);
  const stale = age < 0 || age > 48 * 60 * 60 * 1000;
  return {...p, criteria:checks, evidenceCoveragePercent:known*25,
    matchPercent:known === 4 ? checks.filter(c=>c.pass).length*25 : null,
    eligibility:checks.some(c=>c.pass === false) ? 'does-not-match' : known < 4 ? 'needs-verification' : 'matches',
    stale, available:p.status === 'active' && !stale,
    opportunity:{status:'insufficient-evidence',score:null,reason:'Verified sold comparables and documented adjustments required; asking prices are not valuations.'}};
}
export class PropertyConflict extends Error {}
function canonical(v: unknown): string { if(Array.isArray(v))return '['+v.map(canonical).join(',')+']'; if(v && typeof v==='object')return '{'+Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>JSON.stringify(k)+':'+canonical(x)).join(',')+'}'; return JSON.stringify(v); }
/** Immutable observations; replay same ID is idempotent, changed content conflicts. */
export class PropertyStore {
  constructor(private directory:string) {}
  async read(now=new Date()) {
    let names:string[]; try {names=await readdir(this.directory);} catch(e) {if((e as NodeJS.ErrnoException).code==='ENOENT')return {observations:[],cards:[],followingHistory:[],followingRevision:0};throw e;}
    const observations:PropertyObservation[]=[];
    for(const name of names.filter(n=>/^observation-[a-f0-9]{64}\.json$/.test(n))) observations.push(validateProperty(JSON.parse(await readFile(join(this.directory,name),'utf8'))));
    observations.sort((a,b)=>Date.parse(a.observedAt)-Date.parse(b.observedAt)||a.id.localeCompare(b.id));
    const latest=new Map<string,PropertyObservation>(); for(const p of observations) latest.set(p.listingId,p);
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
      return {...propertyCard(p,now),followed:decisions.get(p.listingId)?.followed??false,changes};
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
      return {...card,budgetHeadroomCad:current===null?null:1_700_000-current,
        askingPriceReductionCad:current===null||initial===null?null:Math.max(0,initial-current),
        realizedSavingsCad:null,negotiatedSavingsCad:null,
        costCoverage:'asking-price-and-published-strata-only',
        missingCosts:['property-tax','insurance','maintenance','financing','closing-costs']};
    })};
  }
  async setFollowing(input:unknown) {
    if(!input || typeof input!=='object')throw Error('Invalid following decision');
    const v=input as {requestId:string;listingId:string;followed:boolean;expectedRevision:number};
    if(!text(v.requestId,160)||!text(v.listingId,160)||typeof v.followed!=='boolean'||!Number.isSafeInteger(v.expectedRevision)||v.expectedRevision<0)throw Error('Invalid following decision');
    await mkdir(this.directory,{recursive:true});const lock=join(this.directory,'following.lock');
    try{await mkdir(lock);}catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')throw new PropertyConflict('Following busy; refresh before retry');throw e;}
    let temp:string|undefined;
    try {
      const state=await this.read();const prior=state.followingHistory.find(d=>d.requestId===v.requestId);
      if(prior){if(prior.listingId!==v.listingId||prior.followed!==v.followed)throw new PropertyConflict('Following request ID conflict');return {duplicate:true,revision:prior.revision};}
      if(state.followingRevision!==v.expectedRevision)throw new PropertyConflict('Following changed; refresh before retry');
      if(!state.cards.some(c=>c.listingId===v.listingId))throw Error('Unknown listing; no following decision saved');
      const decision:FollowingDecision={requestId:v.requestId,listingId:v.listingId,followed:v.followed,revision:state.followingRevision+1,recordedAt:new Date().toISOString()};
      const file=join(this.directory,'following-'+createHash('sha256').update(v.requestId).digest('hex')+'.json');temp=file+'.'+randomUUID()+'.tmp';
      const f=await open(temp,'wx',0o600);try{await f.writeFile(canonical(decision),'utf8');await f.sync();}finally{await f.close();}
      await rename(temp,file);return {duplicate:false,revision:decision.revision};
    }finally{if(temp)await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});await rmdir(lock);}
  }
  async ingest(input:unknown) {
    const p=validateProperty(input), content=canonical(p);
    await mkdir(this.directory,{recursive:true});
    const file=join(this.directory,'observation-'+createHash('sha256').update(p.id).digest('hex')+'.json'),lock=file+'.lock',temp=file+'.'+randomUUID()+'.tmp';
    try {await mkdir(lock);} catch(e) {if((e as NodeJS.ErrnoException).code==='EEXIST')throw new PropertyConflict('Observation busy; reread before retry');throw e;}
    try {
      try {const old=canonical(JSON.parse(await readFile(file,'utf8'))); if(old!==content)throw new PropertyConflict('Observation ID conflict; existing evidence preserved');return {duplicate:true};} catch(e) {if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
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