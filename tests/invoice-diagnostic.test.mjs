import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
test('diagnostic clinic classification propagates failure while default production fallback is unchanged',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'familyhub-classifier-diagnostic-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const script=`import assert from 'node:assert/strict';import {classify} from './apps/worker/dist/invoices.js';const mail={id:'abcdef123456',threadId:'thread',internetMessageId:'<synthetic@example.test>',subject:'Your Receipt',sender:'clinic@janeapp.com',receivedAt:'2026-11-01T12:00:00.000Z',text:'Your receipt is attached',labels:[],unsubscribe:false,bulk:false,attachments:[{Id:'attachment',FileName:'invoice-123.pdf',MimeType:'application/pdf',Size:3,AnalysisStatus:'text-extracted'}],attachmentText:'Invoice number ABC123. Physiotherapy treatment.'};const normal=await classify(mail,'synthetic@example.test','Synthetic');assert.equal(normal.source,'rules');assert.equal(normal.result.kind,'receipt');assert.equal(normal.result.category,'health');await assert.rejects(classify(mail,'synthetic@example.test','Synthetic',true));`;
 const r=spawnSync(process.execPath,['--input-type=module','-e',script],{env:{...process.env,FAMILYHUB_WORKER_DATA:dir,FAMILYHUB_CODEX_PATH:join(dir,'nonexistent-synthetic-cli.exe')},encoding:'utf8'});assert.equal(r.status,0,r.stderr);
});
