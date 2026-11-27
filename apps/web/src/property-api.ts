import type {WorkerConfig} from './types';
import {workerRequestHeaders} from './worker-transport';
import {validateProperty,propertyCard} from '../../worker/src/property-model';
export type PropertyCard=ReturnType<typeof propertyCard>&{followed:boolean;changes:{field:string;before:unknown;after:unknown;observedAt:string;sourceUrl:string}[]};
export type PropertySnapshot={cards:PropertyCard[];followingRevision:number};
function endpoint(config:WorkerConfig){if(!config.Endpoint||!config.ApiKey)throw Error('Pair your PC in Settings to load property listings.');return config.Endpoint.replace(/\/$/,'')+'/property-project';}
export function parsePropertySnapshot(value:unknown):PropertySnapshot {
 const s=value as {cards?:unknown;followingRevision?:unknown};
 if(!s||!Array.isArray(s.cards)||!Number.isSafeInteger(s.followingRevision)||Number(s.followingRevision)<0)throw Error('Invalid property response.');
 const cards=s.cards.map(raw=>{
  const p=validateProperty(raw);if(typeof raw.followed!=='boolean'||!Array.isArray(raw.changes))throw Error('Invalid tracking response.');
  const changes=raw.changes.filter((c:unknown):c is PropertyCard['changes'][number]=>{if(!c||typeof c!=='object')return false;const x=c as PropertyCard['changes'][number];try{return ['priceCad','status'].includes(x.field)&&Number.isFinite(Date.parse(x.observedAt))&&new URL(x.sourceUrl).protocol==='https:';}catch{return false;}});
  return {...propertyCard(p),followed:raw.followed,changes};
 });
 if(new Set(cards.map(c=>c.listingId)).size!==cards.length)throw Error('Duplicate entries in property response.');
 return {cards,followingRevision:Number(s.followingRevision)};
}
export async function fetchProperties(config:WorkerConfig,signal?:AbortSignal){const r=await fetch(endpoint(config),{headers:workerRequestHeaders(config,false),cache:'no-store',signal:signal??AbortSignal.timeout(12000)});if(!r.ok)throw Error(r.status===404?'Update the PC service to load properties.':'Properties unavailable. Check the PC and try again.');return parsePropertySnapshot(await r.json());}
export async function followProperty(config:WorkerConfig,listingId:string,followed:boolean,expectedRevision:number,requestId:string){
 const r=await fetch(endpoint(config)+'/following',{method:'POST',headers:workerRequestHeaders(config),body:JSON.stringify({listingId,followed,expectedRevision,requestId}),signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw Error(r.status===409?'Following status changed. Refresh before retrying.':'Following status not confirmed. Refresh before retrying.');
 // Never optimistically report a stored change: the caller independently reloads.
}
export async function compareProperties(config:WorkerConfig,listingIds:string[]):Promise<Array<ReturnType<typeof propertyCard>&{budgetHeadroomCad:number|null;askingPriceReductionCad:number|null}>>{
 const r=await fetch(endpoint(config)+'/comparison',{method:'POST',headers:workerRequestHeaders(config),body:JSON.stringify({listingIds}),signal:AbortSignal.timeout(12000)});
 if(!r.ok)throw Error('Comparison unavailable. Refresh properties.');
 const body=await r.json();if(!Array.isArray(body.items)||body.items.length<2||body.items.length>3)throw Error('Invalid comparison response.');
 return body.items.map((raw:unknown)=>{
  const p=validateProperty(raw),v=raw as Record<string,unknown>;
  for(const key of ['budgetHeadroomCad','askingPriceReductionCad'])if(v[key]!==null&&(typeof v[key]!=='number'||!Number.isFinite(v[key])))throw Error('Invalid comparison amount.');
  return {...propertyCard(p),budgetHeadroomCad:v.budgetHeadroomCad as number|null,askingPriceReductionCad:v.askingPriceReductionCad as number|null};
 });
}
