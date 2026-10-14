import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
const dir=await mkdtemp(join(tmpdir(),'familyhub-choice-test-'));process.env.FAMILYHUB_WORKER_DATA=dir;
const api=await import('../apps/worker/dist/claim-service-choices.js');test.after(()=>rm(dir,{recursive:true,force:true}));
const dossier={insurer:'blue-cross',fields:{provider:'Sample Clinic',service:'20 min chiropractic return (20 minutes)',originalAmount:80,otherInsurancePaid:64}};
const options=[{value:'return',label:'Chiropractic - Subsequent treatment'},{value:'initial',label:'Chiropractic - Initial assessment'}];
test('confirmed choices persist with exact insurer/provider/service scope; amounts and other answers never persist',async()=>{
 assert.equal(await api.rememberServiceChoice(dossier,'service',options,'return'),true);
 assert.equal(await api.savedServiceChoice({...dossier,fields:{...dossier.fields,originalAmount:95,otherInsurancePaid:null}},'service',options),'return');
 for(const other of [{...dossier,insurer:'desjardins'},{...dossier,fields:{...dossier.fields,provider:'Other Clinic'}},{...dossier,fields:{...dossier.fields,service:'Initial chiropractic assessment'}}])assert.equal(await api.savedServiceChoice(other,'service',options),null);
 const fresh=await import('../apps/worker/dist/claim-service-choices.js?restart');assert.equal(await fresh.savedServiceChoice(dossier,'service',options),'return');
 for(const kind of ['originalAmount','otherInsurance','otherInsurancePaid','patient','serviceDate','practitioner'])assert.equal(await api.rememberServiceChoice(dossier,kind,options,'return'),false);
 const raw=await readFile(join(dir,'claim-service-choices.json'),'utf8');assert.doesNotMatch(raw,/Sample Clinic|20 min|originalAmount|otherInsurance/);assert.equal(JSON.parse(raw).choices.length,1);assert.deepEqual(Object.keys(JSON.parse(raw).choices[0]).sort(),['confirmedAt','kind','label','scope']);
});
test('choices use current labels, refuse missing/ambiguous options, support correction and scoped reset',async()=>{
 const changed=options.map(o=>({...o,value:'new-'+o.value}));assert.equal(await api.savedServiceChoice(dossier,'service',changed),'new-return');
 assert.equal(await api.savedServiceChoice(dossier,'service',options.slice(1)),null);assert.equal(await api.savedServiceChoice(dossier,'service',[...options,{value:'duplicate',label:options[0].label}]),null);
 await api.rememberServiceChoice(dossier,'service',options,'initial');assert.equal(await api.savedServiceChoice(dossier,'service',options),'initial');
 await api.forgetServiceChoices(dossier);assert.equal(await api.savedServiceChoice(dossier,'service',options),null);
 assert.equal(await api.rememberServiceChoice({...dossier,fields:{provider:'',service:dossier.fields.service}},'service',options,'return'),false);
});
test('corrupt preferences abstain and are not overwritten',async()=>{
 await writeFile(join(dir,'claim-service-choices.json'),'broken');await assert.rejects(api.savedServiceChoice(dossier,'service',options));await assert.rejects(api.rememberServiceChoice(dossier,'service',options,'return'));assert.equal(await readFile(join(dir,'claim-service-choices.json'),'utf8'),'broken');
});
