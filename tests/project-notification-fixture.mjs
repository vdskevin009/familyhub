/** Entirely synthetic. No real account, address, vehicle or provider access. */
import {vehicleCard} from '../apps/worker/dist/vehicle-model.js';
import {propertyCard} from '../apps/worker/dist/property-model.js';
export const projectNow=new Date('2026-11-23T16:00:00Z');
export function projectEvidence(kind='vehicle',price=28000,at='2026-11-23T11:00:00Z') {
 const url='https://example.invalid/'+kind+'/synthetic-a', fact=value=>({value,sourceUrl:value===null?null:url,checkedAt:value===null?null:at,note:'Fixture publique fictive'});
 const common={id:kind+'-'+at,listingId:'synthetic-'+kind,observedAt:at,url,status:'active',statusEvidence:fact('active'),priceCad:fact(price)};
 const observation=kind==='vehicle'?{...common,title:'Véhicule fictif A',priceBasis:'before-tax',year:fact(2022),make:fact('Fictive'),model:fact('Nova'),trim:fact('Essai'),mileageKm:fact(40000),location:fact('Localité fictive'),familySuv:fact(true),used:fact(true),greaterVancouver:fact(true),awd:fact(null),accidentHistory:fact(null)}:{...common,address:'100, rue Fictive',bedrooms:fact(3),lowerLonsdale:fact(true),separateEntrances:fact(true),monthlyStrataFeeCad:fact(400),airbnb:{status:'unknown',evidence:[]}};
 return {observations:[observation],followingHistory:[{requestId:'synthetic-follow',listingId:observation.listingId,followed:true,revision:1,recordedAt:'2026-11-23T10:00:00Z'}]};
}
export function changedEvidence(kind='vehicle',price=26500,at='2026-11-23T12:00:00Z') { const before=projectEvidence(kind,kind==='vehicle'?28000:1500000),after=projectEvidence(kind,price,at);return {...before,observations:[...before.observations,...after.observations]}; }
export function projectSnapshot(kind,evidence,now=projectNow) {const latest=evidence.observations.at(-1);return {cards:latest?[{...(kind==='vehicle'?vehicleCard(latest,now):propertyCard(latest,now)),followed:true,changes:evidence.observations.slice(1).filter((o,i)=>o.priceCad.value!==evidence.observations[i].priceCad.value).map((o,i)=>({field:"priceCad",before:evidence.observations[i].priceCad.value,after:o.priceCad.value,observedAt:o.observedAt,sourceUrl:o.priceCad.sourceUrl}))}]:[],followingRevision:evidence.followingHistory.length};}
