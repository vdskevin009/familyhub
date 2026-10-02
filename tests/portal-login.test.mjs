import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const directory = await mkdtemp(join(tmpdir(), 'familyhub-login-'));
process.env.FAMILYHUB_WORKER_DATA = directory;
const auth = await import('../apps/worker/dist/portal-login.js');
test.after(() => rm(directory, { recursive: true, force: true }));
const credentials = { version: 1, insurer: 'desjardins', username: 'synthetic-user', password: 'synthetic-password' };
function fixture({ readyInitially = false, succeeds = false, text = '', submissionError = false, stored = credentials } = {}) {
  let ready = readyInitially, state = { blocked: false }, submissions = 0, reads = 0, now = 100000000;
  const page = { url: () => 'https://id.desjardins.com/login', locator: selector => ({ innerText: async () => text, first() { return this; }, isVisible: async () => false }), waitForTimeout: async n => { now += n; } };
  const deps = { now: () => now, read: async () => state, save: async (_, value) => { state = value; },
    credentials: async () => { reads++; if (stored instanceof Error) throw stored; return stored; },
    submit: async () => { assert.equal(state.blocked, true); submissions++; if (submissionError) throw new Error('sensitive browser diagnostic'); ready = succeeds; } };
  return { page, deps, ready: async () => ready, state: () => state, count: () => submissions, reads: () => reads };
}
test('accepts only exact HTTPS login origins and observed paths', () => {
  assert.equal(auth.allowedLoginUrl('desjardins','https://id.desjardins.com/login?state=synthetic'), true);
  assert.equal(auth.allowedLoginUrl('bluecross','https://service.pac.bluecross.ca/member/login/'), true);
  for (const url of ['http://id.desjardins.com/login','https://id.desjardins.com.evil.test/login','https://id.desjardins.com/reset','https://user@id.desjardins.com/login']) assert.equal(auth.allowedLoginUrl('desjardins',url),false);
});
test('credentials require exact insurer, bounded fields and an explicit Blue Cross role', () => {
  assert.equal(auth.validCredentials(credentials,'desjardins'),true);
  assert.equal(auth.validCredentials(credentials,'bluecross'),false);
  assert.equal(auth.validCredentials({...credentials,password:'bad\nvalue'},'desjardins'),false);
  assert.equal(auth.validCredentials({version:1,insurer:'bluecross',policy:'synthetic',certificate:'synthetic',password:'synthetic',role:'spouse'},'bluecross'),true);
});
test('existing session never loads credentials or submits login', async () => {
  const f=fixture({readyInitially:true}); assert.equal(await auth.tryPortalLogin(f.page,'desjardins',f.ready,f.deps),undefined); assert.equal(f.count(),0); assert.equal(f.reads(),0);
});
test('expired session logs in once and resumes only on authenticated ready evidence', async () => {
  const f=fixture({succeeds:true}); assert.equal(await auth.tryPortalLogin(f.page,'desjardins',f.ready,f.deps),undefined); assert.equal(f.count(),1); assert.equal(f.state().blocked,false);
});
test('ambiguous submit failure is latched across repeated requests without exposing error', async () => {
  const f=fixture({submissionError:true}); assert.equal(await auth.tryPortalLogin(f.page,'desjardins',f.ready,f.deps),'human-required');
  assert.equal(await auth.tryPortalLogin(f.page,'desjardins',f.ready,f.deps),'human-required'); assert.equal(f.count(),1); assert.equal(JSON.stringify(f.state()).includes('sensitive'),false);
});
test('unresolved login times out after one attempt and persists the stop', async () => {
  const f=fixture(); assert.equal(await auth.tryPortalLogin(f.page,'desjardins',f.ready,f.deps),'human-required'); assert.equal(f.count(),1); assert.equal(f.state().blocked,true);
});
test('MFA and rejection screens never trigger an automatic credential submission', async () => {
  for (const [text,reason] of [['Enter verification code','human-required'],['Mot de passe incorrect','credentials-rejected']]) {
    const f=fixture({text}); assert.equal(await auth.tryPortalLogin(f.page,'desjardins',f.ready,f.deps),reason); assert.equal(f.count(),0);
  }
});
test('missing and undecryptable credentials yield distinct safe recovery states', async () => {
  for (const [stored,reason] of [[Object.assign(new Error('missing'),{code:'ENOENT'}),'not-configured'],[new Error('secret diagnostic'),'credentials-unavailable']]) {
    const f=fixture({stored}); assert.equal(await auth.tryPortalLogin(f.page,'desjardins',f.ready,f.deps),reason); assert.equal(f.count(),0);
  }
});
test('cooldown survives restarts and corrupt retry state fails closed', async () => {
  assert.equal(auth.loginGate({blocked:false,attemptedAt:new Date(1000000).toISOString()},1000001),'cooldown');
  await writeFile(join(directory,'desjardins','login-control.json'),'invalid').catch(async()=>{const release=await auth.acquirePortalLock('desjardins');await release();await writeFile(join(directory,'desjardins','login-control.json'),'invalid');});
  assert.equal((await auth.readLoginControl('desjardins')).blocked,true);
});
test('profile lock excludes a second owner and never steals an interrupted lock', async () => {
  const release=await auth.acquirePortalLock('bluecross');
  await assert.rejects(auth.acquirePortalLock('bluecross'),/profile is busy/);
  const moduleUrl = new URL('../apps/worker/dist/portal-login.js', import.meta.url).href;
  const child = await promisify(execFile)(process.execPath, ['--input-type=module','-e', 'const m=await import(' + JSON.stringify(moduleUrl) + '); try {await m.acquirePortalLock("bluecross");process.exitCode=1;}catch{console.log("blocked");}'], {env:{...process.env,FAMILYHUB_WORKER_DATA:directory}});
  assert.match(child.stdout,/blocked/);
  assert.equal(JSON.parse(await readFile(join(directory,'bluecross','collector-lock','owner.json'),'utf8')).pid,process.pid);
  await release(); const again=await auth.acquirePortalLock('bluecross'); await again();
});
test('observed successful manual authentication clears the stop without erasing cooldown', async () => {
  const path=join(directory,'desjardins','login-control.json');
  const attemptedAt=new Date().toISOString();await writeFile(path,JSON.stringify({blocked:true,reason:'human-required',attemptedAt}));
  await auth.authenticatedPortal('desjardins'); assert.deepEqual(await auth.readLoginControl('desjardins'),{blocked:false,attemptedAt});
});

test('observed forms fill only approved fields and submit once for each insurer', async () => {
  for (const insurer of ['desjardins','bluecross']) {
    const calls=[];
    const page={ url:()=>insurer==='desjardins'?'https://id.desjardins.com/login':'https://service.pac.bluecross.ca/member/login/',
      locator:selector=>({count:async()=>1,isVisible:async()=>true,isEditable:async()=>true,getAttribute:async()=>/password/i.test(selector)?'password':'text',
        fill:async value=>calls.push(['fill',selector,value]), check:async()=>calls.push(['check',selector]),click:async()=>calls.push(['submit',selector])}),
      getByRole:(role,options)=>({click:async()=>calls.push(['submit',role,options.name])}) };
    const c=insurer==='desjardins'?credentials:{version:1,insurer,password:'synthetic',policy:'synthetic-policy',certificate:'synthetic-id',role:'spouse'};
    await auth.submitPortalLogin(page,insurer,c);
    assert.equal(calls.filter(x=>x[0]==='submit').length,1);
    assert.equal(calls.filter(x=>x[0]==='fill').length,insurer==='desjardins'?2:3);
    if(insurer==='bluecross')assert.deepEqual(calls.find(x=>x[0]==='check'),['check','input[name="spouse"][value="1"]']);
  }
});
test('Blue Cross matches the observed Login button without matching other actions', async () => {
  let submissions=0;
  const page={url:()=> 'https://service.pac.bluecross.ca/member/login/',
    locator:selector=>({count:async()=>1,isVisible:async()=>true,isEditable:async()=>true,
      getAttribute:async()=>selector==='#password'?'password':'text',fill:async()=>{},check:async()=>{}}),
    getByRole:(role,options)=>({click:async()=>{
      assert.equal(role,'button');
      const matches=label=>options.name instanceof RegExp ? options.name.test(label) : options.name===label;
      assert.equal(matches('Login'),true,'The current portal Login button must be found');
      assert.equal(matches('Login help'),false,'Other login-related actions must not match');
      submissions++;
    }})};
  await auth.submitPortalLogin(page,'bluecross',{version:1,insurer:'bluecross',password:'synthetic',policy:'synthetic-policy',certificate:'synthetic-id',role:'member'});
  assert.equal(submissions,1);
});

test('navigation away between fills prevents transmitting a password to another origin', async () => {
  let url='https://id.desjardins.com/login';const fills=[];
  const page={url:()=>url,locator:selector=>({count:async()=>1,isVisible:async()=>true,isEditable:async()=>true,getAttribute:async()=>/Password/.test(selector)?'password':'text',fill:async value=>{fills.push(value);url='https://unexpected.test/login';}})};
  await assert.rejects(auth.submitPortalLogin(page,'desjardins',credentials),/form changed/);
  assert.deepEqual(fills,['synthetic-user']);
});
test('unrecognized form type never receives a secret', async () => {
  let fills=0; const page={url:()=> 'https://id.desjardins.com/login',locator:()=>({count:async()=>1,isVisible:async()=>true,isEditable:async()=>true,getAttribute:async()=> 'text',fill:async()=>{fills++;}})};
  await assert.rejects(auth.submitPortalLogin(page,'desjardins',credentials),/form changed/);assert.equal(fills,0);
});
test('a rejected password after submission remains disabled across later attempts', async () => {
  const f=fixture(); let body=''; const original=f.deps.submit;
  f.page.locator=()=>({innerText:async()=>body,first(){return this;},isVisible:async()=>false});
  f.deps.submit=async(...args)=>{await original(...args);body='Invalid password';};
  assert.equal(await auth.tryPortalLogin(f.page,'desjardins',f.ready,f.deps),'credentials-rejected');
  body='Login';assert.equal(await auth.tryPortalLogin(f.page,'desjardins',f.ready,f.deps),'credentials-rejected');assert.equal(f.count(),1);
});

test('Windows local setup supports protected set, replace, cancellation and delete', {skip:process.platform !== 'win32'}, async () => {
  const env={...process.env}; for(const key of Object.keys(env))if(key.toLowerCase()==='psmodulepath')delete env[key];
  const result=await promisify(execFile)(process.env.FAMILYHUB_TEST_POWERSHELL || 'powershell.exe',['-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('./insurer-login-setup.ps1',import.meta.url))],{env,timeout:30000});
  assert.match(result.stdout,/checks passed/);
  assert.equal(result.stdout.includes('synthetic-password'),false);
});
