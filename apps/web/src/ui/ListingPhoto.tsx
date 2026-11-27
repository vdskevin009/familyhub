import { useState } from 'react';
import type { PropertyObservation } from '../../../worker/src/property-model';

export function ListingPhoto({photo,label}: {photo:PropertyObservation['primaryPhoto'];label:string}) {
  const [status,setStatus]=useState<'loading'|'ready'|'failed'>('loading');
  if (!photo || status==='failed') return <div className="property-photo-empty">{photo?'Listing photo unavailable':'No photo available'}</div>;
  return <figure className="property-photo">
    {status==='loading'&&<span className="listing-photo-loading">Loading photo…</span>}
    <img src={photo.url} alt={'Listing photo · '+label} loading="lazy" referrerPolicy="no-referrer"
      onLoad={()=>setStatus('ready')} onError={()=>setStatus('failed')}/>
    <figcaption><a href={photo.sourceUrl} target="_blank" rel="noreferrer">{photo.attribution}</a></figcaption>
  </figure>;
}
