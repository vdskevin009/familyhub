import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchFinanceAccountCaptures,fetchFinanceAccountHistory} from '../apps/web/src/worker.ts';
const config={Endpoint:'https://synthetic.invalid',ApiKey:'synthetic'};
for(const [read,capability] of [[fetchFinanceAccountCaptures,'finance-account-captures-v1'],[fetchFinanceAccountHistory,'finance-account-history-v1']]){
 test(capability+' requires capability and rejects unavailable or invalid routes',async()=>{const original=globalThis.fetch;try{let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({capabilities:[]});};assert.equal(await read(config),null);assert.equal(calls,1);for(const mode of ['404','invalid']){globalThis.fetch=async url=>url.endsWith('/health')?Response.json({capabilities:[capability]}):mode==='404'?new Response('',{status:404}):Response.json({capability,unexpected:true});await assert.rejects(read(config));}}finally{globalThis.fetch=original;}});
}
