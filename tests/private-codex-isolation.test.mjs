import test from 'node:test';
import assert from 'node:assert/strict';
import {privateIsolationPlan,privateDisabledFeatures,privateLegacyAliases,disabledCodeModeWarning,verifyPrivateEffectiveConfig,privateAnalysisEventReader,privateFilesystemOverrides,verifyPrivateFilesystemConfig} from '../apps/worker/dist/private-codex-isolation.js';
const config=()=>({config:{apps:{_default:{enabled:true},some_app:{enabled:true}},mcp_servers:{node_repl:{enabled:true},'other.server':{enabled:true}},plugins:{'plugin@market':{enabled:true}}},layers:[{name:{type:'user'},version:'v1'}]});
const inventory=()=>({installed:[{pluginId:'another@market',installed:true,enabled:true,version:'1'}]});
test('generic isolation disables inherited names without requiring Gmail or changing approvals',()=>{
  const p=privateIsolationPlan(config(),inventory());
  assert.ok(p.overrides.includes('mcp_servers={"node_repl"={enabled=false},"other.server"={enabled=false}}'));
  assert.ok(p.overrides.includes('plugins={"another@market"={enabled=false},"plugin@market"={enabled=false}}'));
  assert.ok(p.overrides.includes('apps={"_default"={enabled=false},"some_app"={enabled=false}}'));
  assert.ok(!p.overrides.some(x=>/ignore-user|approval_mode|approvals_reviewer|windows.sandbox|model_catalog/.test(x)));
  for(const key of ['shell_tool','view_image','browser_use','computer_use','apps','plugins','code_mode','multi_agent_v2'])assert.ok(p.overrides.includes(`features.${key}=false`));
});
test('generic isolation rejects malformed inventories and revision/config shapes',()=>{
  for(const mutate of [x=>delete x.config.mcp_servers,x=>x.layers=[],x=>x.layers[0].version=null,x=>x.config.plugins={'bad\nkey':{}}]){
    const c=config();mutate(c);assert.throws(()=>privateIsolationPlan(c,inventory()));
  }
  for(const value of [{}, {installed:[...inventory().installed,...inventory().installed]}, {installed:[{pluginId:'x',installed:true,enabled:true}]}])assert.throws(()=>privateIsolationPlan(config(),value));
});
test('saved permission selections are not silently replaced',()=>{
  const c=config();c.config.default_permissions='user-restricted';assert.throws(()=>privateIsolationPlan(c,inventory()));
});
const profile='familyhub-private-00000000-0000-4000-8000-000000000000',inputs=['C:\\synthetic\\schema.json','C:\\synthetic\\image.png'];
test('filesystem override grants only exact explicit inputs, root deny and disabled network',()=>{
  const values=privateFilesystemOverrides(profile,inputs);
  assert.ok(values.includes('windows.sandbox="mxc"'));
  assert.ok(values.some(v=>v.includes('\":root\"=\"deny\"')&&v.includes('network={enabled=false}')));
  assert.ok(!values.some(v=>/extends|:workspace_roots|:tmpdir|:user_home|write/.test(v)));
  for(const files of [[],['relative.txt'],['C:\\synthetic\\*'],[inputs[0],inputs[0]]])assert.throws(()=>privateFilesystemOverrides(profile,files));
});
test('filesystem metadata rejects widening, wrong backend, inheritance or extra paths',()=>{
  const value=()=>({config:{windows:{sandbox:'mxc'},default_permissions:profile,permissions:{[profile]:{filesystem:{':root':'deny',...Object.fromEntries(inputs.map(p=>[p,'read'])),glob_scan_max_depth:null},network:{enabled:false}}}}});
  verifyPrivateFilesystemConfig(value(),profile,inputs);
  for(const mutate of [c=>c.windows.sandbox='elevated',c=>c.default_permissions='other',c=>c.permissions[profile].extends='other',c=>c.permissions[profile].filesystem[':root']='read',c=>c.permissions[profile].filesystem['C:\\private']='read',c=>c.permissions[profile].filesystem[inputs[0]]='write',c=>c.permissions[profile].network.enabled=true]){
    const v=value();mutate(v.config);assert.throws(()=>verifyPrivateFilesystemConfig(v,profile,inputs));
  }
});
const effective=()=>({config:{features:Object.fromEntries(privateDisabledFeatures.map(k=>[k,false])),approval_policy:'never',web_search:'disabled',history:{persistence:'none'},agents:{enabled:false},mcp_servers:{node_repl:{enabled:false}},plugins:{'plugin@market':{enabled:false}},apps:{_default:{enabled:false},some_app:{enabled:false}}}});
test('effective verification rejects any remaining enabled capability',()=>{
  verifyPrivateEffectiveConfig(effective());
  for(const mutate of [c=>c.features.view_image=true,c=>delete c.features.shell_tool,c=>c.apps.some_app.enabled=true,c=>c.mcp_servers.node_repl.enabled=true,c=>c.plugins['plugin@market'].enabled=true,c=>c.web_search='live',c=>c.agents.enabled=true]){
    const e=effective();mutate(e.config);assert.throws(()=>verifyPrivateEffectiveConfig(e));
  }
});
const starts=JSON.stringify({type:'thread.started'})+'\n'+JSON.stringify({type:'turn.started'})+'\n';
const message={type:'item.completed',item:{type:'agent_message',text:'{"synthetic":true}'}};
test('private response reader handles chunk splits and requires complete turn/exit',()=>{
  const r=privateAnalysisEventReader(),s=starts+JSON.stringify(message)+'\r\n'+JSON.stringify({type:'turn.completed'})+'\n';for(const c of s)r.feed(c);
  assert.equal(r.finish(0),' {"synthetic":true}'.trim());
  for(const text of [JSON.stringify(message),JSON.stringify(message)+'\n']){const x=privateAnalysisEventReader();x.feed(starts+text);assert.throws(()=>x.finish(0));}
});
for(const type of ['mcp_tool_call','command_execution','file_change','web_search','unknown_tool'])test(`private response rejects ${type} evidence`,()=>{
  const r=privateAnalysisEventReader();assert.throws(()=>r.feed(JSON.stringify({type:'item.started',item:{type}})+'\n'));
});
test('private response rejects malformed/errors/over-budget output',()=>{
  for(const text of ['invalid\n',JSON.stringify({type:'turn.failed'})+'\n',JSON.stringify({type:'error'})+'\n',JSON.stringify({type:'unknown_tool_call'})+'\n','x'.repeat(2000001)])assert.throws(()=>privateAnalysisEventReader().feed(text));
});
test('normal todo list is harmless and never becomes model-result evidence',()=>{
  const r=privateAnalysisEventReader();r.feed(starts);r.feed(JSON.stringify({type:'item.updated',item:{type:'todo_list',items:[{text:'arbitrary private text',completed:false}]}})+'\n');
  assert.deepEqual(r.diagnostics().itemTypes,['todo_list']);assert.ok(!JSON.stringify(r.diagnostics()).includes('arbitrary'));
  assert.throws(()=>r.finish(0));r.feed(JSON.stringify(message)+'\n'+JSON.stringify({type:'turn.completed'})+'\n');assert.equal(r.finish(0),' {"synthetic":true}'.trim());
});
test('error diagnostics retain only allowlisted types and structured codes, never messages',()=>{
  const r=privateAnalysisEventReader();assert.throws(()=>r.feed(JSON.stringify({type:'error',message:'PRIVATE arbitrary body',error:{code:'authentication_error',status:401,message:'private'}})+'\n'));
  assert.deepEqual(r.diagnostics().eventTypes,['error']);assert.equal(r.diagnostics().errorCode,'authentication_error');assert.equal(r.diagnostics().httpStatus,401);
  assert.ok(!JSON.stringify(r.diagnostics()).includes('PRIVATE'));const unknown=privateAnalysisEventReader();
  assert.throws(()=>unknown.feed(JSON.stringify({type:'private-secret-event',error:{code:'private-secret-code',status:123456}})+'\n'));
  assert.deepEqual(unknown.diagnostics().eventTypes,['unknown']);assert.equal(unknown.diagnostics().errorCode,null);assert.equal(unknown.diagnostics().httpStatus,null);
});

test('canonical disables replace generated aliases and reject inherited alias enables',()=>{
  const p=privateIsolationPlan(config(),inventory());
  for(const [alias,canonical] of Object.entries(privateLegacyAliases)) {
    assert.ok(p.overrides.includes('features.'+canonical+'=false'));
    assert.ok(!p.overrides.some(v=>v.startsWith('features.'+alias+'=')));
    for(const enabled of [true,false]) {
      const c=config();c.config.features={[alias]:enabled,[canonical]:false};
      const e=effective();e.config.features[alias]=enabled;
      if(enabled) {assert.throws(()=>privateIsolationPlan(c,inventory()));assert.throws(()=>verifyPrivateEffectiveConfig(e));}
      else {privateIsolationPlan(c,inventory());verifyPrivateEffectiveConfig(e);}
    }
  }
});

const verifiedReader=()=>{const e=effective();Object.assign(e.config,{windows:{sandbox:'mxc'},default_permissions:profile,permissions:{[profile]:{filesystem:{':root':'deny',...Object.fromEntries(inputs.map(p=>[p,'read']))},network:{enabled:false}}}});return {effective:e,profile,inputs};};
const warning={type:'item.completed',item:{type:'error',message:disabledCodeModeWarning}};
const feed=(r,e)=>r.feed(JSON.stringify(e)+'\n');
test('exact nonfatal warning requires verified isolation and startup position',()=>{
  assert.throws(()=>feed(privateAnalysisEventReader(),warning));
  const bad=verifiedReader();bad.effective.config.features.code_mode_host=true;assert.throws(()=>privateAnalysisEventReader(bad));
  const widened=verifiedReader();widened.effective.config.permissions[profile].network.enabled=true;assert.throws(()=>privateAnalysisEventReader(widened));
  assert.throws(()=>feed(privateAnalysisEventReader(verifiedReader()),warning));
  const r=privateAnalysisEventReader(verifiedReader());feed(r,{type:'thread.started'});feed(r,warning);assert.equal(r.diagnostics().startupWarningAccepted,true);
  feed(r,{type:'turn.started'});feed(r,message);feed(r,{type:'turn.completed'});assert.equal(r.finish(0),' {"synthetic":true}'.trim());
});
test('duplicate, late, altered, structured-error and actual action/error events remain fatal',()=>{
  for(const before of [warning,{type:'turn.started'},message,{type:'item.started',item:{type:'reasoning'}},{type:'turn.completed'}]){
    const r=privateAnalysisEventReader(verifiedReader());feed(r,{type:'thread.started'});if(before!==warning&&before.type!=='turn.started')feed(r,{type:'turn.started'});feed(r,before);assert.throws(()=>feed(r,warning));
  }
  for(const event of [{...warning,item:{...warning.item,message:disabledCodeModeWarning+' '}},{...warning,type:'item.started'},{...warning,item:{...warning.item,code:'permission_denied'}},{type:'error',message:disabledCodeModeWarning},{type:'turn.failed'},{type:'item.started',item:{type:'mcp_tool_call'}}]){
    const r=privateAnalysisEventReader(verifiedReader());feed(r,{type:'thread.started'});assert.throws(()=>feed(r,event));
  }
});

const {EventEmitter}=await import('node:events');const {PassThrough}=await import('node:stream');
const {collectPrivateProcess,PRIVATE_EXECUTION_TIMEOUT_MS,PRIVATE_TOTAL_TIMEOUT_MS}=await import('../apps/worker/dist/private-codex.js');
const fakeChild=()=>{const c=new EventEmitter();c.stdin=new PassThrough();c.stdout=new PassThrough();c.stderr=new PassThrough();c.kills=0;c.kill=()=>{c.kills++;return true;};return c;};
const tick=()=>new Promise(r=>setImmediate(r));
const successLines=starts+JSON.stringify(message)+'\n'+JSON.stringify({type:'turn.completed'})+'\n';
test('production deadlines include startup and remain bounded',()=>{assert.equal(PRIVATE_EXECUTION_TIMEOUT_MS,240000);assert.equal(PRIVATE_TOTAL_TIMEOUT_MS,300000);});
test('abort kills only owned child and waits for close before rejection/cleanup, never accepts late success',async()=>{
  const c=fakeChild(),ac=new AbortController();let settled=false,cleaned=false;
  const p=collectPrivateProcess(c,privateAnalysisEventReader(),'synthetic',ac.signal).finally(()=>{settled=true;cleaned=true;});const rejected=assert.rejects(p);
  ac.abort();await tick();assert.equal(c.kills,1);assert.equal(settled,false);assert.equal(cleaned,false);
  c.stdout.write(successLines);c.emit('close',0);await rejected;assert.equal(cleaned,true);
});
test('execution timeout waits for closure and reports timeout safely',async()=>{
  const c=fakeChild(),signal=AbortSignal.timeout(10);let settled=false;
  const p=collectPrivateProcess(c,privateAnalysisEventReader(),'synthetic',signal).finally(()=>{settled=true;});const rejected=assert.rejects(p,e=>e.diagnostics.timedOut===true);
  await new Promise(r=>setTimeout(r,25));assert.equal(c.kills,1);assert.equal(settled,false);c.emit('close',null);await rejected;
});
test('over-budget output kills and cannot become a later successful result',async()=>{
  const c=fakeChild();let settled=false;const p=collectPrivateProcess(c,privateAnalysisEventReader(),'synthetic',new AbortController().signal).finally(()=>{settled=true;});const rejected=assert.rejects(p);
  c.stdout.write('x'.repeat(2000001));await tick();assert.equal(c.kills,1);assert.equal(settled,false);c.stdout.write(successLines);c.emit('close',0);await rejected;
});
test('pre-aborted child is terminated without prompt and successful result requires close',async()=>{
  const c=fakeChild(),ac=new AbortController();ac.abort();const p=collectPrivateProcess(c,privateAnalysisEventReader(),'synthetic',ac.signal);const rejected=assert.rejects(p);assert.equal(c.stdin.readableLength,0);c.emit('close',0);await rejected;
  const d=fakeChild();let settled=false;const q=collectPrivateProcess(d,privateAnalysisEventReader(),'synthetic',new AbortController().signal).then(v=>{settled=true;return v;});d.stdout.write(successLines);await tick();assert.equal(settled,false);d.emit('close',0);assert.equal(await q,' {"synthetic":true}'.trim());
});

test('real disposable Node child closes before timeout rejection',async()=>{
  const {spawn}=await import('node:child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:['pipe','pipe','pipe']});let closed=false;c.on('close',()=>{closed=true;});
  await assert.rejects(collectPrivateProcess(c,privateAnalysisEventReader(),'synthetic',AbortSignal.timeout(50)),e=>e.diagnostics.timedOut===true);assert.equal(closed,true);assert.equal(c.killed,true);
});

test('exact warning rejects every extra structured error/code/status even unknown or null',()=>{
  for(const key of ['error','code','status','status_code','http_status_code'])for(const value of ['unknown-private-value',null,999999,{},false])for(const where of ['event','item']){
    const e=structuredClone(warning);if(where==='event')e[key]=value;else e.item[key]=value;
    const r=privateAnalysisEventReader(verifiedReader());feed(r,{type:'thread.started'});assert.throws(()=>feed(r,e),key+where);
  }
});
test('stdin submission error terminates own child and waits close, rejecting late success',async()=>{
  const c=fakeChild();let settled=false;const p=collectPrivateProcess(c,privateAnalysisEventReader(),'synthetic',new AbortController().signal).finally(()=>{settled=true;});const rejected=assert.rejects(p);
  c.stdin.emit('error',new Error('synthetic broken pipe'));await tick();assert.equal(c.kills,1);assert.equal(settled,false);c.stdout.write(successLines);c.emit('close',0);await rejected;
});
test('synchronous stdin submission failure also waits for owned-child close',async()=>{
  const c=fakeChild();c.stdin.end=()=>{throw Error('synthetic write failure');};let settled=false;
  const p=collectPrivateProcess(c,privateAnalysisEventReader(),'synthetic',new AbortController().signal).finally(()=>{settled=true;});const rejected=assert.rejects(p);await tick();assert.equal(c.kills,1);assert.equal(settled,false);c.emit('close',0);await rejected;
});

test('lifecycle requires exactly one ordered thread and turn before content or completion',()=>{
  const th={type:'thread.started'},tu={type:'turn.started'},done={type:'turn.completed'};
  const contents=[message,{type:'item.started',item:{type:'reasoning'}},{type:'item.updated',item:{type:'todo_list',items:[]}}];
  for(const events of [[tu],[done],[th,done],[th,th],[th,tu,tu],[th,tu,th],...contents.map(c=>[c]),...contents.map(c=>[th,c])]){
    const r=privateAnalysisEventReader();assert.throws(()=>events.forEach(e=>feed(r,e)));
  }
  for(const extra of [th,tu,done,...contents,warning,{type:'error'}]){
    const r=privateAnalysisEventReader();r.feed(starts);feed(r,message);feed(r,done);assert.throws(()=>feed(r,extra));
  }
});
