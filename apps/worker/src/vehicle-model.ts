import { date, text, type Evidence } from './property-model.js';
export { date, text }; export type { Evidence };
export type VehicleObservation = {
 id:string; listingId:string; observedAt:string; title:string; url:string;
 status:'active'|'sold'|'withdrawn'|'unavailable'|'unknown'; statusEvidence:Evidence<string>;
 primaryPhoto?:{url:string;sourceUrl:string;attribution:string;checkedAt:string}|null;
 priceBasis:'before-tax'; priceCad:Evidence<number>; year:Evidence<number>; mileageKm:Evidence<number>;
 make:Evidence<string>; model:Evidence<string>; trim:Evidence<string>; location:Evidence<string>;
 familySuv:Evidence<boolean>; used:Evidence<boolean>; greaterVancouver:Evidence<boolean>; awd:Evidence<boolean>;
 accidentHistory:Evidence<string>;
};
function url(v:unknown):v is string {try{const u=new URL(String(v));return typeof v==='string'&&v.length<2000&&u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}}
function evidence(v:unknown,kind:'number'|'boolean'|'string',at:string):boolean {
 if(!v||typeof v!=='object')return false;const e=v as Evidence<unknown>;
 if(typeof e.note!=='string'||e.note.length>1000)return false;
 if(e.value===null)return e.sourceUrl===null&&e.checkedAt===null;
 return typeof e.value===kind&&(kind!=='number'||Number.isFinite(e.value)&&Number(e.value)>=0)&&(kind!=='string'||text(e.value,300))&&url(e.sourceUrl)&&date(e.checkedAt)&&Date.parse(e.checkedAt)<=Date.parse(at);
}
export function validateVehicle(input:unknown):VehicleObservation {
 if(!input||typeof input!=='object')throw Error('Invalid vehicle observation');const p=input as VehicleObservation;
 if(!text(p.id,160)||!text(p.listingId,160)||!date(p.observedAt)||!text(p.title,300)||!url(p.url)||!['active','sold','withdrawn','unavailable','unknown'].includes(p.status)||p.priceBasis!=='before-tax')throw Error('Invalid vehicle identity/date/price basis');
 if(!evidence(p.statusEvidence,'string',p.observedAt)||(p.status==='unknown'?p.statusEvidence.value!==null:p.statusEvidence.value!==p.status))throw Error('Explicit dated status required; disappearance is unknown');
 for(const f of ['priceCad','year','mileageKm'] as const)if(!evidence(p[f],'number',p.observedAt))throw Error('Vehicle numeric facts require evidence');
 for(const f of ['make','model','trim','location','accidentHistory'] as const)if(!evidence(p[f],'string',p.observedAt))throw Error('Vehicle text facts require evidence');
 for(const f of ['familySuv','used','greaterVancouver','awd'] as const)if(!evidence(p[f],'boolean',p.observedAt))throw Error('Vehicle criteria require evidence');
 if(p.priceCad.value!==null&&p.priceCad.value<=0||p.year.value!==null&&(!Number.isInteger(p.year.value)||p.year.value<1900||p.year.value>new Date(p.observedAt).getUTCFullYear()+2)||p.mileageKm.value!==null&&!Number.isInteger(p.mileageKm.value))throw Error('Invalid vehicle amount/year/kilometres');
 if(p.primaryPhoto!=null&&(!url(p.primaryPhoto.url)||!url(p.primaryPhoto.sourceUrl)||!text(p.primaryPhoto.attribution,300)||!date(p.primaryPhoto.checkedAt)||Date.parse(p.primaryPhoto.checkedAt)>Date.parse(p.observedAt)))throw Error('Invalid attributed vehicle photo');
 const fact=<T>(e:Evidence<T>):Evidence<T>=>({value:e.value,sourceUrl:e.sourceUrl,checkedAt:e.checkedAt,note:e.note});
 return {id:p.id,listingId:p.listingId,observedAt:p.observedAt,title:p.title,url:p.url,status:p.status,statusEvidence:fact(p.statusEvidence),priceBasis:p.priceBasis,primaryPhoto:p.primaryPhoto==null?null:{url:p.primaryPhoto.url,sourceUrl:p.primaryPhoto.sourceUrl,attribution:p.primaryPhoto.attribution,checkedAt:p.primaryPhoto.checkedAt},priceCad:fact(p.priceCad),year:fact(p.year),mileageKm:fact(p.mileageKm),make:fact(p.make),model:fact(p.model),trim:fact(p.trim),location:fact(p.location),familySuv:fact(p.familySuv),used:fact(p.used),greaterVancouver:fact(p.greaterVancouver),awd:fact(p.awd),accidentHistory:fact(p.accidentHistory)};
}
export function vehicleCard(input:unknown,now=new Date()){
 const p=validateVehicle(input);const checks=[
 {id:'budget',evidence:p.priceCad,pass:p.priceCad.value===null?null:p.priceCad.value<=30000},
 {id:'suv',evidence:p.familySuv,pass:p.familySuv.value},
 {id:'used',evidence:p.used,pass:p.used.value},
 {id:'area',evidence:p.greaterVancouver,pass:p.greaterVancouver.value}
 ].map(c=>({...c,status:c.pass===null?'unknown':c.pass?'pass':'fail'}));
 const known=checks.filter(c=>c.pass!==null).length,age=now.getTime()-Date.parse(p.observedAt),stale=age<0||age>48*60*60*1000;
 return {...p,criteria:checks,evidenceCoveragePercent:known*25,matchPercent:known===4?checks.filter(c=>c.pass).length*25:null,eligibility:checks.some(c=>c.pass===false)?'does-not-match':known<4?'needs-verification':'matches',stale,available:p.status==='active'&&!stale,
 preferences:{budgetTargetCad:[23000,30000],awdPreferred:true,mileageLimitKm:null},opportunity:{status:'insufficient-evidence',score:null,reason:'Dated comparable vehicles, mileage, condition and history required; asking price is not a valuation.'}};
}
