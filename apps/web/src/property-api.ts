import type {WorkerConfig} from './types';
import {workerRequestHeaders} from './worker-transport';
import {validateProperty,propertyCard} from '../../worker/src/property-model';
export type PropertyCard=ReturnType<typeof propertyCard>&{followed:boolean;changes:{field:string;before:unknown;after:unknown;observedAt:string;sourceUrl:string}[]};
export type PropertySnapshot={cards:PropertyCard[];followingRevision:number};
function endpoint(config:WorkerConfig){if(!config.Endpoint||!config.ApiKey)throw Error('Associez votre PC dans Réglages pour charger les biens.');return config.Endpoint.replace(/\/$/,'')+'/property-project';}
export function parsePropertySnapshot(value:unknown):PropertySnapshot {
 const s=value as {cards?:unknown;followingRevision?:unknown};
 if(!s||!Array.isArray(s.cards)||!Number.isSafeInteger(s.followingRevision)||Number(s.followingRevision)<0)throw Error('Réponse immobilière invalide.');
 const cards=s.cards.map(raw=>{
  const p=validateProperty(raw);if(typeof raw.followed!=='boolean'||!Array.isArray(raw.changes))throw Error('Suivi reçu invalide.');
  const changes=raw.changes.filter((c:unknown):c is PropertyCard['changes'][number]=>{if(!c||typeof c!=='object')return false;const x=c as PropertyCard['changes'][number];try{return ['priceCad','status'].includes(x.field)&&Number.isFinite(Date.parse(x.observedAt))&&new URL(x.sourceUrl).protocol==='https:';}catch{return false;}});
  return {...propertyCard(p),followed:raw.followed,changes};
 });
 if(new Set(cards.map(c=>c.listingId)).size!==cards.length)throw Error('Doublons dans la réponse immobilière.');
 return {cards,followingRevision:Number(s.followingRevision)};
}
export async function fetchProperties(config:WorkerConfig,signal?:AbortSignal){const r=await fetch(endpoint(config),{headers:workerRequestHeaders(config,false),cache:'no-store',signal:signal??AbortSignal.timeout(12000)});if(!r.ok)throw Error(r.status===404?'Mise à jour du PC nécessaire pour les biens.':'Biens indisponibles. Réessayez après vérification du PC.');return parsePropertySnapshot(await r.json());}
export async function followProperty(config:WorkerConfig,listingId:string,followed:boolean,expectedRevision:number,requestId:string){
 const r=await fetch(endpoint(config)+'/following',{method:'POST',headers:workerRequestHeaders(config),body:JSON.stringify({listingId,followed,expectedRevision,requestId}),signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw Error(r.status===409?'Le suivi a changé. Actualisez avant de réessayer.':'Suivi non confirmé. Actualisez avant de réessayer.');
 // Never optimistically report a stored change: the caller independently reloads.
}
export async function compareProperties(config:WorkerConfig,listingIds:string[]):Promise<Array<ReturnType<typeof propertyCard>&{budgetHeadroomCad:number|null;askingPriceReductionCad:number|null}>>{
 const r=await fetch(endpoint(config)+'/comparison',{method:'POST',headers:workerRequestHeaders(config),body:JSON.stringify({listingIds}),signal:AbortSignal.timeout(12000)});
 if(!r.ok)throw Error('Comparaison indisponible. Actualisez les biens.');
 const body=await r.json();if(!Array.isArray(body.items)||body.items.length<2||body.items.length>3)throw Error('Comparaison reçue invalide.');
 return body.items.map((raw:unknown)=>{
  const p=validateProperty(raw),v=raw as Record<string,unknown>;
  for(const key of ['budgetHeadroomCad','askingPriceReductionCad'])if(v[key]!==null&&(typeof v[key]!=='number'||!Number.isFinite(v[key])))throw Error('Montant comparatif invalide.');
  return {...propertyCard(p),budgetHeadroomCad:v.budgetHeadroomCad as number|null,askingPriceReductionCad:v.askingPriceReductionCad as number|null};
 });
}
