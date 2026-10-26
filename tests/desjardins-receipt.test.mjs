import test from 'node:test';import assert from 'node:assert/strict';
import {desjardinsReceiptEvidence} from '../apps/worker/dist/desjardins-receipt.js';
import {desjardinsPatientOption,desjardinsProviderOption} from '../apps/worker/dist/desjardins-claim-form.js';
import {desjardinsAliasFingerprint} from '../apps/worker/dist/desjardins-collector.js';
import {desjardinsDetailSuggestion} from '../apps/worker/dist/desjardins-claim-details.js';
import {dossier,receipt} from './fixtures/desjardins-receipt.mjs';
test('duration is extracted only from the explicit supported service duration',()=>{
 assert.equal(desjardinsDetailSuggestion('durationMinutes',dossier,[],''),'30');
 assert.equal(desjardinsDetailSuggestion('durationMinutes',{...dossier,fields:{...dossier.fields,service:'Physiotherapy'}},[],''),null);
 assert.equal(desjardinsDetailSuggestion('durationMinutes',{...dossier,fields:{...dossier.fields,service:'Subsequent Physiotherapy Session (999 minutes)'}},[],''),null);
});
test('paid residual receipt uses source service date and corroborated gross, preserving printed identity',()=>assert.deepEqual(desjardinsReceiptEvidence(receipt,dossier),{patient:'Alice Example',provider:'Example Clinic',practitioner:'Morgan Example',licence:'1234567',address:'123 Fiction St, #101, Example City, BC, V1V 1V1'}));
for(const [name,body,source] of [
 ['wrong amount',receipt.replaceAll('$25.00','$26.00'),dossier],
 ['unpaid',receipt.replace('authorized succeeded','declined'),dossier],
 ['wrong service date',receipt,{...dossier,fields:{...dossier.fields,serviceDate:'2026-02-18'}}],
 ['missing primary adjudication',receipt,{...dossier,coordination:{importedStatementAvailable:false}}],
 ['second invoice',receipt+'\nInvoice #OTHER',dossier],
 ['wrong patient',receipt.replaceAll('Alice Example','Someone Else'),dossier]
])test(name,()=>assert.equal(desjardinsReceiptEvidence(body,source),null));
test('confirmed patient name supports rotation without dropping or adding tokens',()=>{
 const aliases={[desjardinsAliasFingerprint('EXAMPLE ALICE MIDDLE')]:'Alice'},option={value:'observed',label:'Pour quelle personne assurée réclamez-vous?ALICE MIDDLE EXAMPLE'};
 assert.equal(desjardinsPatientOption(dossier,[option],aliases),'observed');
 assert.equal(desjardinsPatientOption(dossier,[option,option],aliases),null);
 assert.equal(desjardinsPatientOption(dossier,[{...option,label:option.label.replace(' MIDDLE','')}],aliases),null);
 assert.equal(desjardinsPatientOption(dossier,[option],{}),null);
 assert.equal(desjardinsPatientOption(dossier,[option],{...aliases,[desjardinsAliasFingerprint('ALICE MIDDLE EXAMPLE')]:'Other'}),null);
});
test('saved provider requires the verified receipt identity, unique name and matching visible specialty',()=>{
 const identity=desjardinsReceiptEvidence(receipt,dossier),option={value:'provider-radio',label:'Morgan Example'};
 const text='Other Person\nChiropraticien\nMorgan Example\nPhysiothérapeute';
 assert.equal(desjardinsProviderOption(dossier,identity,[option],text),'provider-radio');
 assert.equal(desjardinsProviderOption(dossier,null,[option],text),null);
 assert.equal(desjardinsProviderOption(dossier,identity,[option,option],text),null);
 assert.equal(desjardinsProviderOption(dossier,identity,[option],text.replace('Physiothérapeute','Massothérapeute')),null);
 assert.equal(desjardinsProviderOption(dossier,identity,[option],text+'\nMorgan Example\nPhysiothérapeute'),null);
 assert.equal(desjardinsProviderOption({...dossier,fields:{...dossier.fields,practitioner:'Other Person'}},identity,[option],text),null);
});
