import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {atomicJson,dataDirectory} from "./private-store.js";
import type {ClaimPreparation} from "./claim-preparation.js";
type Answer={scope:string;value:"yes"|"no"|null;revision:number;confirmedAt:string};
type Store={version:1;answers:Answer[];physiotherapyDefault?:Answer};
const path=join(dataDirectory,"claim-coordination-answers.json");
const defaultScope=createHash("sha256").update("desjardins-physiotherapy-government-reimbursement-v1").digest("hex");
const supported=(d:ClaimPreparation)=>d.insurer==="desjardins"&&/^(?:Subsequent Physiotherapy Session \(\d+ minutes\)|Physiotherapy)$/i.test(d.fields.service||"");
const invoiceScope=(d:ClaimPreparation)=>createHash("sha256").update(JSON.stringify(["government-reimbursement-v1",d.expenseId,d.insurer,d.fields])).digest("hex");
async function read():Promise<Store>{
 let raw:string;try{raw=await readFile(path,"utf8");}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return {version:1,answers:[]};throw e;}
 if(raw.length>1000000)throw new Error("Saved coordination answers need review.");
 const s=JSON.parse(raw) as Store,all=[...(Array.isArray(s.answers)?s.answers:[]),...(s.physiotherapyDefault?[s.physiotherapyDefault]:[])];
 if(s.version!==1||!Array.isArray(s.answers)||s.answers.length>1000||new Set(s.answers.map(a=>a.scope)).size!==s.answers.length
  ||(s.physiotherapyDefault&&(s.physiotherapyDefault.scope!==defaultScope||!["no",null].includes(s.physiotherapyDefault.value)))
  ||all.some(a=>!a||!/^[a-f0-9]{64}$/.test(a.scope)||!["yes","no",null].includes(a.value)||!Number.isSafeInteger(a.revision)||a.revision<1||!Number.isFinite(Date.parse(a.confirmedAt))))throw new Error("Saved coordination answers need review.");
 return s;
}
export async function confirmedGovernmentReimbursement(d:ClaimPreparation){
 const s=await read(),scope=invoiceScope(d),a=s.answers.find(a=>a.scope===scope),fallback=supported(d)?s.physiotherapyDefault:undefined;
 return {scope,value:a?a.value:fallback?.value??null,revision:a?.revision??0,source:a?"invoice" as const:fallback?.value?"physiotherapy-default" as const:null,
  defaultScope,defaultValue:fallback?.value??null,defaultRevision:fallback?.revision??0};
}
let pending=Promise.resolve();
export function confirmGovernmentReimbursement(d:ClaimPreparation,input:{confirmed?:unknown;expectedScope?:unknown;expectedRevision?:unknown;value?:unknown;allPhysiotherapy?:unknown}){
 const action=pending.then(async()=>{
  const global=input.allPhysiotherapy===true,scope=global?defaultScope:invoiceScope(d);
  if(d.blocked||d.insurer!=="desjardins"||input.confirmed!==true||input.expectedScope!==scope||!["yes","no",null].includes(input.value as string|null)
   ||(global&&(!supported(d)||!["no",null].includes(input.value as string|null))))throw new Error("Explicitly confirm the coordination answer and its scope.");
  const s=await read(),before=global?s.physiotherapyDefault:s.answers.find(a=>a.scope===scope);
  if(input.expectedRevision!==(before?.revision??0))throw new Error("The coordination answer changed. Read it again.");
  if(!global&&!before&&s.answers.length>=1000)throw new Error("Saved coordination answers need review.");
  const a:Answer={scope,value:input.value as Answer["value"],revision:(before?.revision??0)+1,confirmedAt:new Date().toISOString()};
  if(global)s.physiotherapyDefault=a;else s.answers=[...s.answers.filter(a=>a.scope!==scope),a];
  await atomicJson(path,s);return confirmedGovernmentReimbursement(d);
 });pending=action.then(()=>{},()=>{});return action;
}
