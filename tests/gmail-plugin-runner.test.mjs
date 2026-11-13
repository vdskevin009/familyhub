import test from 'node:test';
import assert from 'node:assert/strict';
import { collectGmailPluginBatch as realCollect, gmailPluginArguments, gmailPluginEventReader, gmailPluginIsolation, validatedGmailFileUrl, validateGmailAttachmentEvidence } from '../apps/worker/dist/gmail-plugin-runner.js';

const account = 'synthetic@example.test', linkId = 'link_synthetic';
// Most scenarios start with an already-correct synthetic profile; binding failures are tested separately below.
const collectGmailPluginBatch=(request,options={})=>realCollect(request,{...options,invoke:(call,signal)=>call.tool==='get_profile'
  ? Promise.resolve({email:account}):options.invoke(call,signal)});
const query = { q: 'after:1 before:2 has:attachment', maxResults: 2 };
const plan = () => ({ account, linkId, queries: [query] });
const message = (id = 'message1') => ({ id, thread_id: 'thread1', internal_date: '1793534400000', label_ids: ['INBOX'], payload: {
  mime_type: 'text/plain', filename: '', headers: [{ name: 'From', value: 'synthetic@example.test' }, { name: 'Subject', value: 'Synthetic' }],
  body: { size: 5, content: 'hello', base64_url_content: null, attachment_id: null }, parts: [] } });
const withAttachment = () => {
  const m = message(); const original = { ...m.payload, headers: [] };
  m.payload = { ...m.payload, mime_type: 'multipart/mixed', body: { size: 0, content: null, attachment_id: null }, parts: [original, {
    mime_type: 'application/pdf', filename: 'synthetic.pdf', headers: [], read_attachment_supported: true,
    body: { size: 8, content: null, attachment_id: 'attachment1' }, parts: [] }] };
  return m;
};
const uri = 'https://sdmntprwestus3.oaiusercontent.com/synthetic/file.pdf?signature=synthetic';
const attachment = () => ({ message_id: 'message1', attachment_id: 'attachment1', filename: 'synthetic.pdf', mime_type: 'application/pdf', size_bytes: 8,
  content: ['EXTRACTED PREVIEW MUST NEVER BE USED'], content_truncated: true,
  file_uri: { download_url: uri, file_id: 'synthetic', mime_type: 'application/pdf', file_name: 'synthetic.pdf' } });
const expected = { tool: 'search_email_ids', arguments: { link_id: linkId, query: query.q, max_results: 2 } };
const event = (type, overrides = {}) => ({ type, item: { id: 'call1', type: 'mcp_tool_call', server: 'codex_apps', tool: 'gmail.search_email_ids', arguments: expected.arguments,
  status: type === 'item.started' ? 'in_progress' : 'completed', error: null,
  result: type === 'item.started' ? null : { structured_content: { message_ids: [], next_page_token: null } }, ...overrides } });
const events = () => [event('item.started'), event('item.completed'), { type: 'turn.completed' }];
const metadata=()=>({config:{apps:{otherApp:{enabled:true},connector_2128aebfecb84f64a069897515042a44:{tools:{send_email:{enabled:true},future_tool:{enabled:true}}}},
  mcp_servers:{otherServer:{enabled:true}},plugins:{'local@market':{enabled:true}}},layers:[{name:{type:'user'},version:'revision1'}]});
const inventory=()=>({installed:[{pluginId:'gmail@openai-curated-remote',installed:true,enabled:true,version:'1'},
  {pluginId:'dynamic@market',installed:true,enabled:true,version:'2'}]});

test('isolation discovers and overrides every inherited app, MCP server and installed plugin',()=>{
  const result=gmailPluginIsolation(metadata(),inventory(),'search_email_ids');
  assert.ok(result.overrides.includes('apps.otherApp.enabled=false'));
  assert.ok(result.overrides.includes('mcp_servers={"otherServer"={enabled=false}}'));
  for(const value of ['"local@market"={enabled=false}','"dynamic@market"={enabled=false}','"future_tool"={enabled=false}'])
    assert.ok(result.overrides.some(override=>override.includes(value)));
  assert.ok(!result.overrides.some(override=>/^(?:apps|plugins|mcp_servers)\."/.test(override)));
  assert.ok(result.overrides.some(override=>override.includes('"gmail.search_email_ids"={enabled=true}')));
  for(const name of ['send_email','read_attachment','batch_read_email','get_profile'])
    assert.ok(result.overrides.some(override=>override.includes(`"gmail.${name}"={enabled=false}`)));
  const changed=metadata();changed.layers[0].version='revision2';
  assert.notEqual(result.revision,gmailPluginIsolation(changed,inventory(),'search_email_ids').revision);
});
test('isolation respects explicit Gmail, chosen-tool and feature denies',()=>{
  for(const mutate of [m=>m.config.apps.connector_2128aebfecb84f64a069897515042a44.enabled=false,
    m=>m.config.apps._default={enabled:false},
    m=>m.config.apps.connector_2128aebfecb84f64a069897515042a44.default_tools_enabled=false,
    m=>m.config.apps.connector_2128aebfecb84f64a069897515042a44.tools.search_email_ids={enabled:false},
    m=>m.config.apps.connector_2128aebfecb84f64a069897515042a44.tools['gmail.search_email_ids']={enabled:false},
    m=>m.config.features={apps:false}]) {const m=metadata();mutate(m);assert.throws(()=>gmailPluginIsolation(m,inventory(),'search_email_ids'));}
});
test('explicit enabled selected app/tool may override disabled defaults without removing approval mode',()=>{
  const m=metadata();m.config.apps._default={enabled:false};const gmail=m.config.apps.connector_2128aebfecb84f64a069897515042a44;
  gmail.enabled=true;gmail.default_tools_enabled=false;gmail.tools.search_email_ids={enabled:true,approval_mode:'prompt'};
  const result=gmailPluginIsolation(m,inventory(),'search_email_ids');
  assert.ok(!result.overrides.some(value=>value.includes('approval_mode')));
});
test('unknown inventory/config shape, missing Gmail, duplicate plugins and malformed names fail closed',()=>{
  for(const mutate of [m=>delete m.config.apps,m=>m.layers=[],m=>m.config.mcp_servers=null,m=>m.config.plugins=[]]) {
    const m=metadata();mutate(m);assert.throws(()=>gmailPluginIsolation(m,inventory(),'search_email_ids'));
  }
  for(const mutate of [i=>i.installed=[],i=>i.installed[0].enabled=false,i=>i.installed.push({...i.installed[0]}),i=>delete i.installed[0].version,
    i=>i.installed[1].pluginId='bad\nname']) {const i=inventory();mutate(i);assert.throws(()=>gmailPluginIsolation(metadata(),i,'search_email_ids'));}
});

test('CLI invocation is ephemeral, read-only and denies unused surfaces', () => {
  const args = gmailPluginArguments('search_email_ids');
  for (const flag of ['--ephemeral','--json','--strict-config','read-only','features.shell_tool=false','apps._default.enabled=false','apps._default.open_world_enabled=false','history.persistence="none"']) assert.ok(args.includes(flag));
  assert.ok(args.includes('apps.connector_2128aebfecb84f64a069897515042a44.default_tools_enabled=false'));
  for(const name of ['send_email','send_draft','create_draft','archive_emails','delete_emails','batch_read_email','read_attachment'])
    assert.ok(args.includes(`apps.connector_2128aebfecb84f64a069897515042a44.tools.${name}.enabled=false`));
  assert.throws(() => gmailPluginArguments('send_email'));
});
test('JSONL reader accepts split chunks, CRLF and genuine structured result without model evidence', () => {
  const reader = gmailPluginEventReader(expected);
  const text = [...events(), { type:'item.completed',item:{type:'agent_message',text:'invented result'} }].map(x=>JSON.stringify(x)).join('\r\n')+'\r\n';
  for (let i=0;i<text.length;i+=7) reader.push(text.slice(i,i+7));
  assert.deepEqual(reader.finish(0), { message_ids:[],next_page_token:null });
});
for (const [name, mutate] of [
  ['wrong account', e => e[0].item.arguments = { ...expected.arguments, link_id:'link_other' }],
  ['altered query', e => e[0].item.arguments = { ...expected.arguments, query:'in:anywhere' }],
  ['extra argument', e => e[0].item.arguments = { ...expected.arguments, label_ids:['INBOX'] }],
  ['wrong tool', e => e[0].item.tool='gmail.send_email'],
  ['wrong server', e => e[0].item.server='other'],
  ['duplicate start', e => e.splice(1,0,structuredClone(e[0]))],
  ['duplicate completion', e => e.splice(2,0,structuredClone(e[1]))],
  ['missing started', e => e.shift()],
  ['missing completion', e => e.splice(1,1)],
  ['tool failure', e => e[1].item.status='failed'],
  ['tool error', e => e[1].item.error={message:'private details'}],
  ['missing structured result', e => e[1].item.result={content:[{text:'fake'}]}],
  ['unplanned shell', e => e.unshift({type:'item.started',item:{type:'command_execution'}})],
  ['turn failure', e => e.push({type:'turn.failed'})],
]) test(`event reader rejects ${name}`, () => {
  const e=events(); mutate(e); const reader=gmailPluginEventReader(expected);
  assert.throws(()=>{reader.push(e.map(x=>JSON.stringify(x)).join('\n')+'\n');reader.finish(0)});
});
test('reader rejects partial final line, malformed JSON, nonzero process status and model-only output', () => {
  for(const input of ['{bad}\n', JSON.stringify(events()[0]), JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'done'}})+'\n']) {
    const reader=gmailPluginEventReader(expected);assert.throws(()=>{reader.push(input);reader.finish(0)});
  }
  const reader=gmailPluginEventReader(expected);reader.push(events().map(x=>JSON.stringify(x)).join('\n')+'\n');assert.throws(()=>reader.finish(1));
});
test('coordinator owns exact query pagination and deduplicates authorized standalone reads', async () => {
  const calls=[];
  const batch=await collectGmailPluginBatch({...plan(),messageIds:['message2']},{invoke:async call=>{
    calls.push(call);assert.equal(call.arguments.link_id,linkId);
    if(call.tool==='search_email_ids')return call.arguments.next_page_token?{message_ids:['message2'],next_page_token:null}:{message_ids:['message1'],next_page_token:'page2'};
    return {responses:call.arguments.message_ids.map(message)};
  }});
  assert.equal(batch.messages.length,2);assert.equal(batch.queries[0].pages.length,2);
  assert.deepEqual(calls[1].arguments,{link_id:linkId,query:query.q,max_results:2,next_page_token:'page2'});
  assert.deepEqual(calls[2].arguments.message_ids,['message2','message1']);
});
test('empty terminal query is valid and missing queries are not invented',async()=>{
  const b=await collectGmailPluginBatch(plan(),{invoke:async()=>({message_ids:[],next_page_token:null})});
  assert.equal(b.queries[0].complete,true);assert.equal(b.messages.length,0);
});
test('original bytes are downloaded; truncated extracted preview never replaces the file', async () => {
  let downloads=0;
  const batch=await collectGmailPluginBatch({account,linkId,queries:[],messageIds:['message1']},{invoke:async call=>{
    if(call.tool==='batch_read_email')return{structuredContent:{responses:[withAttachment()]}};
    validateGmailAttachmentEvidence(call);assert.equal(call.attachmentEvidence.fromTool,'batch_read_email');return{structuredContent:attachment()};},
    download:async(url,size)=>{downloads++;assert.equal(url,uri);assert.equal(size,8);return Buffer.from('%PDF-123')}});
  assert.equal(downloads,1);assert.equal(Buffer.from(batch.attachments[0].data,'base64url').toString(),'%PDF-123');
});
test('attachment calls require exact validated parent provenance, never arbitrary supplied IDs/support',()=>{
  const call={tool:'read_attachment',arguments:{link_id:linkId,message_id:'message1',attachment_id:'attachment1'},attachmentEvidence:{fromTool:'batch_read_email',linkId,
    messageId:'message1',attachmentId:'attachment1',filename:'synthetic.pdf',mimeType:'application/pdf',sizeBytes:8,readAttachmentSupported:true}};
  validateGmailAttachmentEvidence(call);
  for(const mutate of [c=>delete c.attachmentEvidence,c=>c.attachmentEvidence.messageId='other',c=>c.attachmentEvidence.attachmentId='other',
    c=>c.attachmentEvidence.linkId='link_other',c=>c.attachmentEvidence.readAttachmentSupported=false,c=>c.attachmentEvidence.fromTool='model_summary',c=>c.attachmentEvidence.sizeBytes=0]){
    const c=structuredClone(call);mutate(c);assert.throws(()=>validateGmailAttachmentEvidence(c));
  }
});
test('unnamed non-text originals retain empty source filenames and exact bytes',async()=>{
  const m=withAttachment(),a=attachment();
  m.payload.parts[1].filename='';m.payload.parts[1].mime_type='image/png';
  a.filename='';a.mime_type='image/png';a.file_uri.file_name='';a.file_uri.mime_type='image/png';
  const bytes=Buffer.from([137,80,78,71,13,10,26,10]);
  const batch=await collectGmailPluginBatch({account,linkId,queries:[],messageIds:['message1']},{invoke:async call=>{
    if(call.tool==='batch_read_email')return{responses:[m]};
    validateGmailAttachmentEvidence(call);assert.equal(call.attachmentEvidence.filename,'');return a;
  },download:async()=>bytes});
  assert.equal(batch.messages[0].payload.parts[1].filename,'');
  assert.deepEqual(Buffer.from(batch.attachments[0].data,'base64url'),bytes);
});
test('unnamed text, multipart, malformed MIME and non-leaf assets fail before original reads',async()=>{
  for(const mime of ['text/plain','TEXT/HTML','multipart/related','MULTIPART/MIXED','invalid','image/png']){
    const m=withAttachment();m.payload.parts[1].filename='';m.payload.parts[1].mime_type=mime;
    if(mime==='image/png')m.payload.parts[1].parts=[message().payload];
    let attachments=0;
    await assert.rejects(collectGmailPluginBatch({account,linkId,queries:[],messageIds:['message1']},{invoke:async call=>{
      if(call.tool==='batch_read_email')return{responses:[m]};attachments++;return attachment();
    },download:async()=>Buffer.from('%PDF-123')}));
    assert.equal(attachments,0);
  }
});
for (const [name, response] of [
  ['omitted terminal field', {message_ids:[]}],
  ['undefined terminal field', {message_ids:[],next_page_token:undefined}],
  ['missing tail token shape', {message_ids:['message1'],next_page_token:12}],
  ['duplicate IDs', {message_ids:['message1','message1'],next_page_token:null}],
  ['too many IDs', {message_ids:['message1','message2','message3'],next_page_token:null}],
  ['bad message identity', {message_ids:['../secret'],next_page_token:null}],
]) test(`coordinator rejects ${name}`,async()=>assert.rejects(collectGmailPluginBatch(plan(),{invoke:async()=>response})));
test('pagination loop or missing full read fails the whole collection',async()=>{
  await assert.rejects(collectGmailPluginBatch(plan(),{invoke:async()=>({message_ids:[],next_page_token:'same'})}));
  await assert.rejects(collectGmailPluginBatch({account,linkId,queries:[],messageIds:['message1']},{invoke:async()=>({responses:[]})}));
});
test('batch read order may differ, but duplicate or unauthorized returned IDs are rejected',async()=>{
  const p={account,linkId,queries:[],messageIds:['message1','message2']};
  const b=await collectGmailPluginBatch(p,{invoke:async()=>({responses:[message('message2'),message('message1')]})});
  assert.deepEqual(b.messages.map(m=>m.id),p.messageIds);
  for(const ids of [['message1','message1'],['message1','other']])await assert.rejects(collectGmailPluginBatch(p,{invoke:async()=>({responses:ids.map(message)})}));
});
test('unsupported attachments stop before read_attachment or download',async()=>{
  let calls=0;const m=withAttachment();m.payload.parts[1].read_attachment_supported=false;
  await assert.rejects(collectGmailPluginBatch({account,linkId,queries:[],messageIds:['message1']},{invoke:async()=>{calls++;return {responses:[m]}}}));
  assert.equal(calls,1);
});
test('identity, declared size, original host and downloaded bytes must match',async()=>{
  for(const mutate of [a=>a.message_id='other',a=>a.attachment_id='other',a=>a.filename='other.pdf',a=>a.size_bytes=9,a=>a.file_uri.download_url='http://127.0.0.1/secret']) {
    const a=attachment();mutate(a);let downloads=0;
    await assert.rejects(collectGmailPluginBatch({account,linkId,queries:[],messageIds:['message1']},{invoke:async call=>call.tool==='batch_read_email'?{responses:[withAttachment()]}:a,download:async()=>{downloads++;return Buffer.from('%PDF-123')}}));
    assert.equal(downloads,0);
  }
  await assert.rejects(collectGmailPluginBatch({account,linkId,queries:[],messageIds:['message1']},{invoke:async call=>call.tool==='batch_read_email'?{responses:[withAttachment()]}:attachment(),download:async()=>Buffer.from('short')}));
});
test('URL validation rejects redirects destinations, suffix tricks, userinfo, fragments and ports',()=>{
  assert.equal(validatedGmailFileUrl(uri),uri);
  for(const url of ['http://sdmntprwestus3.oaiusercontent.com/x','https://sdmntprwestus3.oaiusercontent.com.evil.test/x','https://evil.test/sdmntprwestus3.oaiusercontent.com','https://user:password@sdmntprwestus3.oaiusercontent.com/x','https://sdmntprwestus3.oaiusercontent.com:444/x','https://sdmntprwestus3.oaiusercontent.com/x#fragment','file:///secret']) assert.throws(()=>validatedGmailFileUrl(url));
});
test('abort and message limit prevent any tool invocation',async()=>{
  const controller=new AbortController();controller.abort();let calls=0;
  await assert.rejects(collectGmailPluginBatch(plan(),{signal:controller.signal,invoke:async()=>{calls++;return {}}}));
  await assert.rejects(collectGmailPluginBatch({...plan(),messageIds:Array.from({length:201},(_,i)=>`id${i}`)},{invoke:async()=>{calls++;return {}}}));
  assert.equal(calls,0);
});
test('authoritative profile matches exact link before any source reads',async()=>{
  const seen=[];
  const b=await realCollect(plan(),{invoke:async call=>{seen.push(call);return call.tool==='get_profile'?{email:account}:{message_ids:[],next_page_token:null}}});
  assert.equal(b.account,account);assert.equal(seen[0].tool,'get_profile');assert.deepEqual(seen[0].arguments,{link_id:linkId});
  for(const profile of [{email:'other@example.test'}, {}, {email:null}]){
    let calls=0;
    await assert.rejects(realCollect(plan(),{invoke:async call=>{calls++;assert.equal(call.tool,'get_profile');return profile}}));
    assert.equal(calls,1);
  }
});
test('mutable caller plan cannot change a request after execution starts',async()=>{
  const p=plan();const original=p.queries[0].q;
  await collectGmailPluginBatch(p,{invoke:async call=>{p.linkId='link_other';p.queries[0].q='changed';assert.equal(call.arguments.query,original);assert.equal(call.arguments.link_id,linkId);return {message_ids:[],next_page_token:null}}});
});
