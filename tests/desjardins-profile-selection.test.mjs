import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const directory=await mkdtemp(join(tmpdir(),'familyhub-profile-selection-'));
process.env.FAMILYHUB_WORKER_DATA=directory;
test.after(()=>rm(directory,{recursive:true,force:true}));
const profile=await import('../apps/worker/dist/desjardins-profile-selection.js');
const url='https://id.desjardins.com/staticp/gia-externe-gpap-connect/connexion/selection-profil?state=synthetic';
function fixture(labels=['synthetic-profile'],options={}){
  let current=options.url||url, chosen=-1, submitted=0, checked=false; const tiles=labels.map((label,index)=>({innerText:async()=>label,isVisible:async()=>true,isEnabled:async()=>true,click:async()=>{chosen=index;checked=true;if(options.leaveOrigin)current='https://unexpected.test';},evaluate:async()=>checked}));
  const submit={count:async()=>1,isVisible:async()=>true,isEnabled:async()=>true,click:async()=>{submitted++;if(options.submitError)throw new Error('synthetic uncertain submission');current='https://www.agea-gbim.dsf-dfs.com/AGEA-GBIM/Default.aspx';}};
  const form={count:async()=>1,isVisible:async()=>true,locator:selector=>selector==='dsd-select-tile'?{all:async()=>tiles}:submit};
  const page={url:()=>current,locator:selector=>selector==='body'?{innerText:async()=>options.challenge||''}:form,waitForURL:async()=>{}};
  return {page,chosen:()=>chosen,submitted:()=>submitted};
}
test('profile selection requires exact trusted HTTPS origin and observed path',()=>{assert.equal(profile.isDesjardinsProfileSelection(url),true);for(const bad of [url.replace('https:','http:'),url.replace('id.desjardins.com','id.desjardins.com.evil.test'),url.replace('selection-profil','reset-password')])assert.equal(profile.isDesjardinsProfileSelection(bad),false);});
test('profile choice is unique or an exact preferred label, never first of several',()=>{assert.equal(profile.uniqueDesjardinsProfile(['one']),0);assert.equal(profile.uniqueDesjardinsProfile(['one','two']),undefined);assert.equal(profile.uniqueDesjardinsProfile(['one','two'],' TWO '),1);assert.equal(profile.uniqueDesjardinsProfile(['one','one'],'one'),undefined);assert.equal(profile.uniqueDesjardinsProfile(['']),undefined);});
test('single ordinary profile without an operator preference continues once',async()=>{const f=fixture();assert.equal(await profile.continueDesjardinsProfileSelection(f.page,async()=>undefined,async()=>true),true);assert.equal(f.chosen(),0);assert.equal(f.submitted(),1);await profile.continueDesjardinsProfileSelection(f.page,async()=>undefined,async()=>true);assert.equal(f.submitted(),1);});
test('multiple profiles without exact preference stay reviewable',async()=>{const f=fixture(['one','two']);assert.equal(await profile.continueDesjardinsProfileSelection(f.page,async()=>'unknown@example.test'),false);assert.equal(f.chosen(),-1);assert.equal(f.submitted(),0);});
test('recognized human challenge and untrusted origin never select or submit a profile',async()=>{for(const options of [{challenge:'Enter verification code'},{url:'https://unexpected.test/selection-profil'}]){const f=fixture(['one'],options);assert.equal(await profile.continueDesjardinsProfileSelection(f.page,async()=>undefined,async()=>true),false);assert.equal(f.chosen(),-1);assert.equal(f.submitted(),0);}});
test('navigation away after choosing and an uncertain submit cannot be replayed',async()=>{const departed=fixture(['one'],{leaveOrigin:true});assert.equal(await profile.continueDesjardinsProfileSelection(departed.page,async()=>undefined,async()=>true),false);assert.equal(departed.submitted(),0);const uncertain=fixture(['one'],{submitError:true});await assert.rejects(profile.continueDesjardinsProfileSelection(uncertain.page,async()=>undefined,async()=>true));assert.equal(await profile.continueDesjardinsProfileSelection(uncertain.page,async()=>undefined,async()=>true),false);assert.equal(uncertain.submitted(),1);});

test('persistent selection stop prevents the same transaction replay across new pages',async()=>{assert.equal(await profile.claimDesjardinsProfileSelection(url),true);assert.equal(await profile.claimDesjardinsProfileSelection(url),false);assert.equal(await profile.claimDesjardinsProfileSelection(url.replace('state=synthetic','state=another-synthetic')),true);assert.equal(await profile.claimDesjardinsProfileSelection(url.split('?')[0]),false);});

test('an explicit account preference never falls back to another single profile',async()=>{assert.equal(profile.uniqueDesjardinsProfile(['other'],'approved'),undefined);const f=fixture(['other']);assert.equal(await profile.continueDesjardinsProfileSelection(f.page,async()=>'approved',async()=>true),false);assert.equal(f.chosen(),-1);assert.equal(f.submitted(),0);});
test('an unreadable operator preference cannot silently select the only remaining account',async()=>{const f=fixture();await assert.rejects(profile.continueDesjardinsProfileSelection(f.page,async()=>{throw Error('synthetic unreadable preference')},async()=>true));assert.equal(f.chosen(),-1);assert.equal(f.submitted(),0);});
