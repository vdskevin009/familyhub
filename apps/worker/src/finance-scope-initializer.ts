import {assertInferencePolicyPin} from './finance-inference-pin.js';
import {mkdir,readFile,unlink,access,realpath,rename,readdir} from 'node:fs/promises';
import {join,dirname,isAbsolute} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {readState,durableExclusive,financeScopeDigest,vancouverFinanceTime,dailyFinanceDigest,validateReceipt,financeStages} from './finance-daily-gate.js';
export type FinanceScopePolicy={schema:1|2;inferencePolicySha256?:string;timezone:'America/Vancouver';from:string;through:'current-local-day';mappingFile:string;mappingSha256:string;contributionsConfigSha256:string;accountPolicy:'all-linked';accountScope:'returned-institution-accounts'};
const sha=(v:Buffer)=>createHash('sha256').update(v).digest('hex');
async function exists(file:string){try{await access(file);return true}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return false;throw e}}
/** Local only; uses the SAME exclusive lease as begin. Never clears another owner's lock. */
export async function initializeFinanceScope(directory:string,policyFile:string,now=new Date()){
 const root=await realpath(directory);for(let p=root;;p=dirname(p)){if(await exists(join(p,'.git')))throw Error('Private directory required.');if(dirname(p)===p)break}
 const gate=join(root,'finance-feed/daily-gate'),scopeFile=join(root,'finance-feed/daily-scope.json'),local=vancouverFinanceTime(now);
 const state=await readState(join(gate,'state.json'));
 if(state.days[local.day]?.status==='complete'){
  if(state.pending)throw Error('Completed day conflicts with pending work.');
  const scope=JSON.parse(await readFile(scopeFile,'utf8')),record=state.days[local.day],proof=JSON.parse(await readFile(join(gate,'verified-'+record.artifactDigest+'.json'),'utf8'));
  if(financeScopeDigest(scope)!==record.scopeDigest||proof.report.receipts.length!==financeStages.length||new Set(proof.report.receipts.map((r:any)=>r.payload.stage)).size!==financeStages.length||!proof.report.receipts.every((r:any)=>validateReceipt(r,proof.attempt,scope)))throw Error('Completion scope proof mismatch.');
  return {action:'skip',reason:'already-complete',localDate:local.day};
 }
 if(local.minute<480||local.minute>=1260)return {action:'skip',reason:'outside-window',localDate:local.day};
 if(state.pending)throw Error('Pending admission requires original-scope recovery.');
 await mkdir(gate,{recursive:true});const lock=join(gate,'lease.lock');await durableExclusive(lock,JSON.stringify({schema:1,scopeInitialization:true,at:now.toISOString()}));
 try{
  const current=await readState(join(gate,'state.json'));if(dailyFinanceDigest(current)!==dailyFinanceDigest(state)||current.pending||await exists(join(gate,'finalize.lock')))throw Error('Concurrent or unresolved state.');
  if(!await exists(join(gate,'state.json'))&&(await readdir(gate)).some(n=>n!=='lease.lock'&&!/^scope-\d{4}-\d{2}-\d{2}\.json$/.test(n)))throw Error('Orphan gate artifacts require review.');
  const policy:FinanceScopePolicy=JSON.parse(await readFile(policyFile,'utf8'));
  if(Object.keys(policy).filter(k=>k!=='inferencePolicySha256').sort().join('|')!==['schema','timezone','from','through','mappingFile','mappingSha256','contributionsConfigSha256','accountPolicy','accountScope'].sort().join('|')||![1,2].includes(policy.schema)||(policy.schema===1&&policy.inferencePolicySha256!==undefined)||(policy.schema===2&&!/^[a-f0-9]{64}$/.test(policy.inferencePolicySha256??''))||policy.timezone!=='America/Vancouver'||policy.through!=='current-local-day'||policy.accountPolicy!=='all-linked'||policy.accountScope!=='returned-institution-accounts'||!/^\d{4}-\d{2}-\d{2}$/.test(policy.from)||!policy.mappingFile||!(/^[a-f0-9]{64}$/).test(policy.mappingSha256)||!(/^[a-f0-9]{64}$/).test(policy.contributionsConfigSha256))throw Error('Explicit reviewed scope policy required.');
  await assertInferencePolicyPin(root,policy.inferencePolicySha256);
  if(!isAbsolute(policy.mappingFile))throw Error('Absolute reviewed mapping path required.');
  const mappingPath=await realpath(policy.mappingFile);for(let p=dirname(mappingPath);;p=dirname(p)){if(await exists(join(p,'.git')))throw Error('Mapping must remain outside repositories.');if(dirname(p)===p)break}
  const mappingBytes=await readFile(mappingPath),configBytes=await readFile(join(root,'contributions/config.json'));
  if(sha(mappingBytes)!==policy.mappingSha256||sha(configBytes)!==policy.contributionsConfigSha256)throw Error('Reviewed mapping or Contributions configuration changed.');
  const mapping=JSON.parse(mappingBytes.toString()),config=JSON.parse(configBytes.toString());
  if(!mapping||Array.isArray(mapping)||typeof mapping!=='object'||Object.entries(mapping).some(([k,v])=>!k||typeof v!=='string'||!v))throw Error('Invalid reviewed mapping.');
  if(config.schema!==1||!Array.isArray(config.plans)||!config.plans.length||config.plans.some((p:any)=>typeof p.id!=='string'||!p.id))throw Error('Invalid current Contributions plans.');
  const scope={schema:1 as const,...(policy.inferencePolicySha256?{inferencePolicySha256:policy.inferencePolicySha256}:{}),periods:[{from:policy.from,through:local.day}],subjects:{collection:['accounts','transactions','investment_holdings','investment_transactions','recurring_transactions','liabilities'],accounts:['returned-institution-accounts'],balances:['returned-institution-accounts'],transactions:['all-linked-source-universe'],contributions:config.plans.map((p:any)=>p.id).sort()},mappingDigest:policy.mappingSha256,accountPolicy:policy.accountPolicy,accountScope:policy.accountScope};
  const digest=financeScopeDigest(scope),record=current.days[local.day];
  if(record){if(record.scopeDigest!==digest)throw Error('Same-day scope drift requires review.');const saved=JSON.parse(await readFile(scopeFile,'utf8'));if(financeScopeDigest(saved)!==digest)throw Error('Persisted scope drift requires review.');return {action:'ready',reason:'existing-day-scope',localDate:local.day}}
  if(await exists(scopeFile)){const old=JSON.parse(await readFile(scopeFile,'utf8')),oldDigest=financeScopeDigest(old);if(oldDigest!==digest&&!Object.entries(current.days).some(([day,r])=>day<local.day&&r.scopeDigest===oldDigest))throw Error('Unknown previous scope requires review.');}
  const archive=join(gate,'scope-'+local.day+'.json'),bytes=JSON.stringify(scope);
  try{await durableExclusive(archive,bytes)}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST'||await readFile(archive,'utf8')!==bytes)throw e}
  if(dailyFinanceDigest(await readState(join(gate,'state.json')))!==dailyFinanceDigest(current))throw Error('State changed before scope persistence.');
  const temporary=scopeFile+'.'+randomUUID()+'.tmp';await durableExclusive(temporary,bytes);await rename(temporary,scopeFile);if(financeScopeDigest(JSON.parse(await readFile(scopeFile,'utf8')))!==digest)throw Error('Scope readback mismatch.');
  return {action:'ready',reason:'scope-initialized-not-admitted',localDate:local.day};
 }finally{await unlink(lock)}
}
