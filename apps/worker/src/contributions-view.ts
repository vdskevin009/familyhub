import {readFinanceRegisterBindings} from './finance-register-bindings.js';
import { readInferencePolicy, inferenceView } from './contribution-inference-readback.js';
import { FinanceSourceExpensesStore } from './finance-source-expenses-store.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FinanceState } from './finance-model.js';
import { contributionProgress, type ContributionPlan } from './contribution-progress.js';
export type ContributionDisplayPlan = ContributionPlan & {
 id: string; kind: 'rrsp'|'resp'; title: string; beneficiaryName?: string;
 attribution: 'confirmed'|'unconfirmed'; retrievedAt: string|null;
 weeklyTransactionIds?: string[];
 weeklySchedule?: { amountCents: number; weekday: number; assumption: string };
};
export type ContributionsConfig = {schema:1;timezone:string;daysPerMonth:number;plans:ContributionDisplayPlan[]};
function dateOnly(d:Date){return d.toISOString().slice(0,10)}
function weeklyProjection(plan:ContributionDisplayPlan,today:string,included:{id:string;amountCents:number}[]) {
 if(!plan.weeklySchedule)return null;
 const w=plan.weeklySchedule;
 if(!Number.isSafeInteger(w.amountCents)||w.amountCents<=0||!Number.isInteger(w.weekday)||w.weekday<0||w.weekday>6||!w.assumption.trim())throw new Error('Invalid private weekly configuration.');
 const date=new Date(today+'T12:00:00Z'); date.setUTCDate(date.getUTCDate()+1);
 while(date.getUTCDay()!==w.weekday)date.setUTCDate(date.getUTCDate()+1);
 const firstFutureDate=dateOnly(date);let remainingOccurrences=0;
 while(dateOnly(date)<=plan.through){remainingOccurrences++;if(remainingOccurrences>1000)throw new Error('Projection period too long.');date.setUTCDate(date.getUTCDate()+7)}
 const realized=included.filter(r=>(plan.weeklyTransactionIds??[]).includes(r.id));
 return {amountCents:w.amountCents,weekday:w.weekday,firstFutureDate:remainingOccurrences?firstFutureDate:null,through:plan.through,remainingOccurrences,futureCents:remainingOccurrences*w.amountCents,realizedCount:realized.length,realizedCents:realized.reduce((a,r)=>a+r.amountCents,0),assumption:w.assumption};
}
export function contributionsView(state:FinanceState,config:ContributionsConfig,today:string){
 if(config.schema!==1||!Number.isFinite(config.daysPerMonth)||config.daysPerMonth<=0||!Array.isArray(config.plans)||config.plans.length>20||new Set(config.plans.map(p=>p.id)).size!==config.plans.length)throw new Error('Invalid private contribution configuration.');
 const plans=config.plans.map(plan=>{
  if(!plan.id||!['rrsp','resp'].includes(plan.kind)||!['confirmed','unconfirmed'].includes(plan.attribution)||!plan.title.trim())throw new Error('Invalid private contribution configuration.');
  const progress=contributionProgress(state,plan,today);
  const payments=progress.included.map(r=>({...r,kind:(plan.weeklyTransactionIds??[]).includes(r.id)?'weekly':'one-off'})).sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
  const unassigned=(plan.unassignedSourceObservations??[]).filter(r=>r.date>=plan.from&&r.date<=plan.through&&r.date<=today);
  return {id:plan.id,kind:plan.kind,title:plan.title,...(plan.beneficiaryName?{beneficiaryName:plan.beneficiaryName}:{}),attribution:plan.attribution,beneficiaryConfirmed:plan.attribution==='confirmed',currency:plan.currency,personalGoalCents:plan.personalGoalCents,identifiedCents:progress.observedTransferCents,deadline:plan.through,remainingCents:progress.remainingAgainstObservedCents,sourceFreshness:'unknown',sourceAsOf:null,retrievedAt:plan.retrievedAt,status:'partial',warnings:progress.warnings,payments,unassigned,weeklyProjection:weeklyProjection(plan,today,progress.included)};
 });
 return {schema:1,evaluatedOn:today,daysPerMonth:config.daysPerMonth,plans};
}
export async function readContributionsView(directory:string,state:FinanceState,now=new Date()){
 let content:string;
 try{content=await readFile(join(directory,'contributions','config.json'),'utf8')}
 catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {schema:1,evaluatedOn:dateOnly(now),daysPerMonth:30,plans:[]};throw error}
 const config=JSON.parse(content) as ContributionsConfig;
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:config.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  const view=contributionsView(state,config,today);
 try{
  const policy=await readInferencePolicy(directory);
  if(!policy)return view;
  return inferenceView(view,state,config,await new FinanceSourceExpensesStore(directory).read(now),policy,today,(await readFinanceRegisterBindings(join(directory,'finances'),state)).bindings);
 }catch{return {...view,plans:view.plans.map(p=>({...p,inferredCents:null,inferredPayments:[],inferenceStatus:'source-unavailable'}))};}
}