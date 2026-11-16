import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {inferredContributions} from './contribution-inference.js';
const dailyFinanceDigest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x)).digest('hex');
import type {FinanceState} from './finance-model.js';
import type {ContributionsConfig} from './contributions-view.js';
import type {SourceExpensesState} from './finance-source-expenses-model.js';
export async function readInferencePolicy(directory:string){
 try {const bytes=await readFile(join(directory,'contributions','inference-policy.json'));if(bytes.length>65536)throw Error('Inference policy exceeds limit');return {policy:JSON.parse(bytes.toString('utf8')) as unknown,hash:createHash('sha256').update(bytes).digest('hex')};}
 catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}
}
export function inferenceView(base:any,state:FinanceState,config:ContributionsConfig,source:SourceExpensesState,policy:{policy:unknown;hash:string}|null,today:string,bindings:{accounts:Record<string,string>;transactions:Record<string,string>}={accounts:{},transactions:{}}){
 if(!policy)return base;
 const inferred=inferredContributions(state,config,source,policy.policy,today,bindings);
 return {...base,inferencePolicySha256:policy.hash,plans:base.plans.map((p:{id:string})=>({...p,...inferred[p.id]}))};
}
/** Exact whole-envelope comparison, not arbitrary field stripping. Receipt progress stays legacy. */
export function verifyInferenceView(base:any,api:unknown,state:FinanceState,config:ContributionsConfig,source:SourceExpensesState,policy:{policy:unknown;hash:string}|null,today:string,bindings:{accounts:Record<string,string>;transactions:Record<string,string>}={accounts:{},transactions:{}}){
 const expected=inferenceView(base,state,config,source,policy,today,bindings);
 if(dailyFinanceDigest(expected)!==dailyFinanceDigest(api))throw Error('Contribution inference extension mismatch');
 return policy?.hash??null;
}
