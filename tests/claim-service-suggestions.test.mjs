import test from 'node:test';import assert from 'node:assert/strict';import {validatedServiceProposals} from '../apps/worker/dist/claim-service-suggestions.js';
const fields=[{key:'service',kind:'service',options:[{value:'follow',label:'Chiropractic return'},{value:'initial',label:'Initial assessment'}]}];const p={key:'service',value:'follow',confidence:.99,ambiguous:false,evidence:'chiropractic return',reason:'The invoice explicitly says chiropractic return.'};
test('Codex suggestion must reference literal service evidence and one current unique option',()=>{
 assert.equal(validatedServiceProposals({suggestions:[p]},'20 min chiropractic return',fields)[0].value,'follow');
 for(const invalid of [{...p,value:'hidden'},{...p,confidence:.8},{...p,ambiguous:true},{...p,evidence:'invented service'}])assert.equal(validatedServiceProposals({suggestions:[invalid]},'20 min chiropractic return',fields)[0].value,null);
 assert.equal(validatedServiceProposals({suggestions:[p,p]},'20 min chiropractic return',[...fields,{key:'benefit',options:[]}])[0].value,null);
});
test('clinical professions remain distinct and ambiguous labels abstain',()=>{
 const f=[{key:'service',kind:'service',options:[{value:'follow',label:'Clinical Counsellor'}]}];assert.equal(validatedServiceProposals({suggestions:[{...p,evidence:'Social Worker'}]},'Social Worker',f)[0].value,null);
 assert.equal(validatedServiceProposals({suggestions:[p]},'20 min chiropractic return',[{...fields[0],options:[...fields[0].options,{value:'dup',label:'Chiropractic return'}]}])[0].value,null);
});
