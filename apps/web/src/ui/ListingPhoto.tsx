import { useState } from 'react';
import type { PropertyObservation } from '../../../worker/src/property-model';

export function ListingPhoto({photo,label}: {photo:PropertyObservation['primaryPhoto'];label:string}) {
  const [status,setStatus]=useState<'loading'|'ready'|'failed'>('loading');
  if (!photo || status==='failed') return <div className="property-photo-empty">{photo?'Photo de l’annonce indisponible':'Photo non disponible'}</div>;
  return <figure className="property-photo">
    {status==='loading'&&<span className="listing-photo-loading">Chargement de la photo…</span>}
    <img src={photo.url} alt={'Photo de l’annonce · '+label} loading="lazy" referrerPolicy="no-referrer"
      onLoad={()=>setStatus('ready')} onError={()=>setStatus('failed')}/>
    <figcaption><a href={photo.sourceUrl} target="_blank" rel="noreferrer">{photo.attribution}</a></figcaption>
  </figure>;
}
