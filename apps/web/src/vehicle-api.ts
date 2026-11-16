import type {WorkerConfig} from './types';
import {workerRequestHeaders} from './worker-transport';
import {validateVehicle,vehicleCard} from '../../worker/src/vehicle-model';
export type VehicleCard=ReturnType<typeof vehicleCard>&{followed:boolean;changes:{field:string;before:unknown;after:unknown;observedAt:string;sourceUrl:string}[]};
export type VehicleSnapshot={cards:VehicleCard[];followingRevision:number};
function endpoint(config:WorkerConfig){if(!config.Endpoint||!config.ApiKey)throw Error('Associez votre PC dans Réglages pour charger les véhicules.');return config.Endpoint.replace(/\/$/,'')+'/vehicle-project';}
export function parseVehicleSnapshot(value:unknown):VehicleSnapshot {
 const s=value as {cards?:unknown;followingRevision?:unknown};
 if(!s||!Array.isArray(s.cards)||!Number.isSafeInteger(s.followingRevision)||Number(s.followingRevision)<0)throw Error('Réponse véhicule invalide.');
 const cards=s.cards.map(raw=>{
  const p=validateVehicle(raw);if(typeof raw.followed!=='boolean'||!Array.isArray(raw.changes))throw Error('Suivi reçu invalide.');
  const changes=raw.changes.filter((c:unknown):c is VehicleCard['changes'][number]=>{if(!c||typeof c!=='object')return false;const x=c as VehicleCard['changes'][number];try{return ['priceCad','status'].includes(x.field)&&Number.isFinite(Date.parse(x.observedAt))&&new URL(x.sourceUrl).protocol==='https:';}catch{return false;}});
  return {...vehicleCard(p),followed:raw.followed,changes};
 });
 if(new Set(cards.map(c=>c.listingId)).size!==cards.length)throw Error('Doublons dans la réponse véhicule.');
 return {cards,followingRevision:Number(s.followingRevision)};
}
export async function fetchVehicles(config:WorkerConfig,signal?:AbortSignal){const r=await fetch(endpoint(config),{headers:workerRequestHeaders(config,false),cache:'no-store',signal:signal??AbortSignal.timeout(12000)});if(!r.ok)throw Error(r.status===404?'Mise à jour du PC nécessaire pour les véhicules.':'Véhicules indisponibles. Réessayez après vérification du PC.');return parseVehicleSnapshot(await r.json());}
export async function followVehicle(config:WorkerConfig,listingId:string,followed:boolean,expectedRevision:number,requestId:string){
 const r=await fetch(endpoint(config)+'/following',{method:'POST',headers:workerRequestHeaders(config),body:JSON.stringify({listingId,followed,expectedRevision,requestId}),signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw Error(r.status===409?'Le suivi a changé. Actualisez avant de réessayer.':'Suivi non confirmé. Actualisez avant de réessayer.');
 // Never optimistically report a stored change: the caller independently reloads.
}
export async function compareVehicles(config:WorkerConfig,listingIds:string[]):Promise<Array<ReturnType<typeof vehicleCard>&{budgetHeadroomCad:number|null;askingPriceReductionCad:number|null}>>{
 const r=await fetch(endpoint(config)+'/comparison',{method:'POST',headers:workerRequestHeaders(config),body:JSON.stringify({listingIds}),signal:AbortSignal.timeout(12000)});
 if(!r.ok)throw Error('Comparaison indisponible. Actualisez les véhicules.');
 const body=await r.json();if(!Array.isArray(body.items)||body.items.length<2||body.items.length>3)throw Error('Comparaison reçue invalide.');
 if(body.items.length!==listingIds.length || new Set(body.items.map((v:{listingId?:unknown})=>v.listingId)).size!==listingIds.length || body.items.some((v:{listingId?:unknown})=>!listingIds.includes(String(v.listingId))))throw Error('Comparaison reçue incohérente.'); return body.items.map((raw:unknown)=>{
  const p=validateVehicle(raw),v=raw as Record<string,unknown>;
  for(const key of ['budgetHeadroomCad','askingPriceReductionCad'])if(v[key]!==null&&(typeof v[key]!=='number'||!Number.isFinite(v[key])))throw Error('Montant comparatif invalide.');
  return {...vehicleCard(p),budgetHeadroomCad:v.budgetHeadroomCad as number|null,askingPriceReductionCad:v.askingPriceReductionCad as number|null};
 });
}


