import React,{useEffect,useRef} from 'react';
import {X} from 'lucide-react';
import type {Evidence} from '../../../worker/src/property-model';

type Criterion = {id:string; pass:boolean|null};
const dateLabel = (value:string) => new Intl.DateTimeFormat('fr-CA', {timeZone:'America/Vancouver', day:'numeric', month:'short', year:'numeric'}).format(new Date(value));

export function ProjectDialog({title,onClose,children}:{title:string;onClose:()=>void;children:React.ReactNode}) {
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    const dialog=ref.current,opener=document.activeElement,overflow=document.body.style.overflow;
    dialog?.showModal();document.body.style.overflow='hidden';
    return()=>{dialog?.close();document.body.style.overflow=overflow;if(opener instanceof HTMLElement&&opener.isConnected)opener.focus();};
  },[]);
  return <dialog ref={ref} className="property-dialog" aria-label={title} onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{
    if(e.target!==e.currentTarget)return;
    const box=e.currentTarget.getBoundingClientRect();
    if(e.clientX<box.left||e.clientX>box.right||e.clientY<box.top||e.clientY>box.bottom)onClose();
  }}><header><h2>{title}</h2><button aria-label="Fermer" onClick={onClose}><X aria-hidden="true"/></button></header>{children}</dialog>;
}

/** Project suitability is not a market-value score or an independent verification. */
export function ProjectFit({criteria,onOpen,labels}:{criteria:Criterion[];onOpen?:()=>void;labels?:Record<string,string>}) {
  const confirmed=criteria.filter(c=>c.pass===true).length;
  const failed=criteria.filter(c=>c.pass===false).length;
  const unknown=criteria.filter(c=>c.pass===null).length;
  const label=failed?'Hors critères':unknown?'À confirmer':'Correspond au projet';
  const counts=[`${confirmed}/${criteria.length} respectés`,failed?`${failed} écart${failed>1?'s':''}`:'',unknown?`${unknown} à vérifier`:''].filter(Boolean).join(' · ');
  const first=criteria.find(c=>c.pass===false)??criteria.find(c=>c.pass===null);
  const reason=first&&labels?(first.pass===null?`${labels[first.id]} à vérifier`:`Écart : ${labels[first.id]}`):counts;
  const content=<><span>{label}</span><span className="project-fit-marks" aria-hidden="true">{criteria.map(c=><span key={c.id} data-state={c.pass===null?'unknown':c.pass?'pass':'fail'}>{c.pass===null?'?':c.pass?'✓':'✕'}</span>)}</span><small>{reason}</small></>;
  return onOpen?<button className="project-fit" aria-label={`Adéquation au projet : ${label}. ${counts}. ${reason}. Voir les preuves.`} onClick={onOpen}>{content}</button>:<div className="project-fit">{content}</div>;
}

export function ProjectObservation({observedAt}:{observedAt:string}) {
  return <p className="project-observation">Observation du <time dateTime={observedAt}>{dateLabel(observedAt)}</time></p>;
}

export type ProjectFact={label:string;value:string;evidence:Evidence<unknown>;criterion?:boolean|null};
export function ProjectCriteria({facts}:{facts:ProjectFact[]}) {
  const unresolved=facts.filter(f=>f.criterion!==true);
  return <>{unresolved.length>0&&<ProjectFacts facts={unresolved}/>}<details className="project-evidence-disclosure"><summary>Tous les critères et sources</summary><ProjectFacts facts={facts}/></details></>;
}
export function ProjectFacts({facts}:{facts:ProjectFact[]}) {
  return <dl className="project-facts">{facts.map(({label,value,evidence,criterion})=><div key={label}>
    <dt>{label}</dt><dd><strong>{value}</strong>{criterion!==undefined&&!(criterion===null&&value==='À vérifier')&&<span className="project-fact-state">{criterion===null?'À vérifier':criterion?'Critère respecté':'Critère non respecté'}</span>}
      {evidence.note&&<p>{evidence.note}</p>}
      {evidence.sourceUrl&&<a href={evidence.sourceUrl} target="_blank" rel="noopener noreferrer">Source : {label}</a>}
      {evidence.checkedAt?<small>Source consultée le <time dateTime={evidence.checkedAt}>{dateLabel(evidence.checkedAt)}</time></small>:<small>Source et date non documentées</small>}
    </dd>
  </div>)}</dl>;
}
