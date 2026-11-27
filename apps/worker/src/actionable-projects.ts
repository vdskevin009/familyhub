import type { Candidate, NotificationEvidence } from './notification-model.js';
import { propertyCard, type PropertyObservation } from './property-model.js';
import { vehicleCard, type VehicleObservation } from './vehicle-model.js';
export type ProjectActionEvidence = { observations: (PropertyObservation | VehicleObservation)[] };

const day=86_400_000;
export const actionCategories=['open-claim','new-property','new-vehicle'] as const;
export const isActionCategory=(value:string)=>actionCategories.some(kind=>kind===value);
type Domain='property'|'vehicle';
type Observation=PropertyObservation|VehicleObservation;
const normalized=(value:unknown)=>String(value??'').trim().toLowerCase();
function listingURL(input:string) {
  const url=new URL(input);
  url.hash='';
  for(const key of Array.from(url.searchParams.keys())) if(/^(utm_|gclid$|fbclid$)/i.test(key))url.searchParams.delete(key);
  url.searchParams.sort();
  return url.href;
}
function latest(evidence:ProjectActionEvidence) {
  const groups=new Map<string,Observation[]>();
  for(const row of evidence.observations) {
    const rows=groups.get(row.listingId)??[];
    rows.push(row);groups.set(row.listingId,rows);
  }
  return [...groups.values()].flatMap(rows=>{
    const sorted=rows.slice().sort((a,b)=>Date.parse(b.observedAt)-Date.parse(a.observedAt));
    const row=sorted[0];
    const prices=new Map<number,number>();
    for(const obs of rows){
      if(obs.priceCad.value===null || !obs.priceCad.checkedAt)continue;
      const time=Date.parse(obs.priceCad.checkedAt);
      if(prices.has(time) && prices.get(time)!==obs.priceCad.value)return [];
      prices.set(time,obs.priceCad.value);
    }
    if(sorted[1] && Date.parse(sorted[1].observedAt)===Date.parse(row.observedAt))return [];
    return [{row,first:Date.parse(sorted[sorted.length-1].observedAt)}];
  });
}

/** Only existing, validated observations enter this projection; it never requests a listing. */
export function newProjectActions(domain:Domain,evidence:ProjectActionEvidence,now:Date):Candidate[] {
  const at=now.getTime(), horizon=2*day;
  const fresh=(value:string|null)=>value!==null && at-Date.parse(value)>=0 && at-Date.parse(value)<horizon;
  const entries=latest(evidence);
  const counts=new Map<string,number>();
  for (const {row} of entries) {
    const url=listingURL(row.url);
    counts.set(url,(counts.get(url)??0)+1);
  }
  const unique=entries.filter(entry=>counts.get(listingURL(entry.row.url))===1 && fresh(entry.row.observedAt) &&
    fresh(entry.row.statusEvidence.checkedAt) && fresh(entry.row.priceCad.checkedAt) && entry.row.status==='active' && entry.row.priceCad.value!==null);
  const results: Candidate[]=[];
  for(const {row,first} of unique) {
    if(at-first<0 || at-first>=horizon)continue;
    const card=domain==='property'?propertyCard(row,now):vehicleCard(row,now);
    if(!card.criteria.every(c=>c.pass===true && fresh(c.evidence.checkedAt)))continue;
    let detail:string;
    let links=[{label:'Annonce et prix relevé',url:row.priceCad.sourceUrl!}];
    if(domain==='vehicle') {
      const car=row as VehicleObservation;
      const keys=['make','model','year','trim','awd'] as const;
      if(car.awd.value!==true || car.mileageKm.value===null || !fresh(car.mileageKm.checkedAt) || keys.some(k=>!normalized(car[k].value) || !fresh(car[k].checkedAt)))continue;
      const others=unique.map(x=>x.row as VehicleObservation).filter(p=>p.listingId!==car.listingId && p.greaterVancouver.value===true && fresh(p.greaterVancouver.checkedAt) && p.used.value===true && fresh(p.used.checkedAt) &&
        keys.every(k=>normalized(p[k].value)===normalized(car[k].value) && fresh(p[k].checkedAt)) && fresh(p.mileageKm.checkedAt) && p.mileageKm.value!==null && Math.abs(p.mileageKm.value-car.mileageKm.value!)<=10_000);
      // Use the lowest comparable ask, not a median inflated by repeated expensive ads.
      const sources=others.map(p=>listingURL(p.priceCad.sourceUrl!));
      const independentUrls=others.filter((p,i)=>sources[i]!==listingURL(car.priceCad.sourceUrl!) && sources.indexOf(sources[i])===sources.lastIndexOf(sources[i]));
      const references=independentUrls.sort((a,b)=>a.priceCad.value!-b.priceCad.value!).slice(0,3);
      if(references.length<3 || car.priceCad.value!>references[0].priceCad.value!*0.90)continue;
      links=references.map(p=>({label:'Référence affichée · '+p.priceCad.value+' CAD · '+p.priceCad.checkedAt!.slice(0,10),url:p.priceCad.sourceUrl!}));
      detail='SUV d’occasion AWD dans le budget. Prix avant taxes au moins 10 % sous chacune des trois annonces locales de référence ou plus, de même année et version, à 10 000 km près. Vérifier NIV, frais et inspection.';
    } else detail='Prix affiché dans le budget, au moins trois chambres, secteur recherché et deux entrées documentées. Vérifier le plan et les coûts avant une visite.';
    const dates=[first,Date.parse(row.priceCad.checkedAt!),Date.parse(row.statusEvidence.checkedAt!),...card.criteria.map(c=>Date.parse(c.evidence.checkedAt!))];
    results.push({key:'new-project:'+domain+':'+row.listingId,source:domain==='vehicle'?'new-vehicle':'new-property',kind:domain==='vehicle'?'new-vehicle':'new-property',
      actionable:true,pushEligible:true,priority:1,expiresAt:new Date(Math.min(...dates)+horizon).toISOString(),title:domain==='vehicle'?'Nouvelle auto à examiner':'Nouveau bien correspondant au projet',
      detail,target:{view:domain,recordId:row.listingId},sourceDate:row.priceCad.checkedAt!,links});
  }
  return results;
}

export function openClaimActions(snapshot:NotificationEvidence['invoices'],now:Date):Candidate[]|undefined {
  const until=Date.parse(snapshot?.lastSuccess??'')+7*day;
  if(!snapshot || snapshot.setupRequired || snapshot.busy || snapshot.error || snapshot.coverage?.complete!==true || snapshot.coverage.heldMessages!==0 || !(until>now.getTime() && until<=now.getTime()+7*day))return undefined;
  return snapshot.reconciliations.flatMap(claim=>{
    const since=claim.WorkflowChangedAt,age=now.getTime()-Date.parse(since??'');
    if(!since || !Number.isFinite(age) || age<14*day || claim.WorkflowStatus!=='open' || !['waiting-primary','waiting-secondary'].includes(claim.Status) ||
      claim.HasUnresolvedReimbursementEvidence || claim.OriginalInvoiceMissing || !(Number(claim.PotentialRemaining)>0) ||
      !snapshot.items.some(item=>item.Id===claim.ExpenseDocumentId && !item.IgnoredAt && !item.NeedsReview))return [];
    return [{key:'open-claim:'+claim.Id+':'+since,kind:'open-claim',source:'open-claim',actionable:true,pushEligible:true,priority:2,expiresAt:new Date(until).toISOString(),
      title:'Dossier de remboursement à vérifier',detail:'Dossier ouvert depuis au moins 14 jours avec solde potentiel. Vérifier si la demande a été transmise et si une réponse manque. La date d’ouverture ne prouve pas l’envoi à l’assureur.',
      sourceDate:since,target:{view:'reimbursements',recordId:claim.Id}}];
  });
}
