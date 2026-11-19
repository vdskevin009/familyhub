import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ProjectFit,ProjectFacts} from '../src/ui/ProjectEvidence';

test('project fit distinguishes missing facts, failed criteria and complete fit without a value score',()=>{
  const criteria=[{id:'a',pass:true},{id:'b',pass:true},{id:'c',pass:true},{id:'d',pass:null}];
  const unknown=renderToStaticMarkup(<ProjectFit criteria={criteria} onOpen={()=>{}}/>);
  const failed=renderToStaticMarkup(<ProjectFit criteria={criteria.map(c=>c.id==='d'?{...c,pass:false}:c)} onOpen={()=>{}}/>);
  const complete=renderToStaticMarkup(<ProjectFit criteria={criteria.map(c=>({...c,pass:true}))}/>);
  assert.match(unknown,/À confirmer/);assert.match(unknown,/1 à vérifier/);
  assert.match(failed,/Hors critères/);assert.match(failed,/1 écart/);
  assert.match(complete,/Correspond au projet/);
  assert.doesNotMatch(unknown+failed+complete,/100%|score|bonne affaire/i);
});

test('a mismatch stays explicit even when another criterion is unknown',()=>{
  const html=renderToStaticMarkup(<ProjectFit criteria={[{id:'a',pass:false},{id:'b',pass:null}]}/>);
  assert.match(html,/Hors critères/);assert.match(html,/1 écart/);assert.match(html,/1 à vérifier/);
});

test('facts preserve actual notes and source dates, unknown never becomes zero or an invented source',()=>{
  const html=renderToStaticMarkup(<ProjectFacts facts={[
    {label:'Entrées',value:'À vérifier',criterion:null,evidence:{value:null,sourceUrl:null,checkedAt:null,note:'Non documenté'}},
    {label:'Strata',value:'500 $',evidence:{value:500,sourceUrl:'https://example.com/fictitious',checkedAt:'2026-11-19T00:30:00Z',note:'Déclaration de l’annonce, pas un Form B'}}
  ]}/>);
  assert.match(html,/Source et date non documentées/);assert.match(html,/Non documenté/);
  assert.match(html,/2026-11-19T00:30:00Z/);assert.match(html,/18 nov/);
  assert.match(html,/pas un Form B/);assert.match(html,/Source : Strata/);
  assert.doesNotMatch(html,/Source : Entrées|>0 \$/);
});
