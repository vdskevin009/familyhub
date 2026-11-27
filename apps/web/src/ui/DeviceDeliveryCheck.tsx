import {useEffect,useState} from 'react';
import type {NotificationSnapshot} from '../../../worker/src/notification-library';
import {applicationServerKey} from '../notifications';

type LocalState = {state:'checking'|'inactive'|'missing'|'error'} | {state:'subscribed';id:string;keyMismatch:boolean};
export function DeviceDeliveryCheck({snapshot,permission,version}:{snapshot:NotificationSnapshot|null;permission:string;version:string}) {
  const [local,setLocal]=useState<LocalState>({state:'checking'});
  useEffect(()=>{
    const serviceWorkers=navigator.serviceWorker;
    if(!serviceWorkers){setLocal({state:"inactive"});return;}
    let current=true;
    let generation=0;
    async function read(){
      const epoch=++generation;
      const update=(value:LocalState)=>{if(current && generation===epoch)setLocal(value);};
      try {
        const reg=await serviceWorkers.getRegistration();
        if(!reg?.active){update({state:'inactive'});return;}
        const sub=await reg.pushManager.getSubscription();
        if(!sub){update({state:'missing'});return;}
        const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(sub.endpoint));
        const id=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
        const key=sub.options?.applicationServerKey;
        const keyMismatch=!!(key && snapshot?.publicKey && new Uint8Array(key).join()!==applicationServerKey(snapshot.publicKey).join());
        update({state:'subscribed',id,keyMismatch});
      }catch{update({state:'error'});}
    }
    void read();
    window.addEventListener('focus',read);
    serviceWorkers.addEventListener('controllerchange',read);
    return ()=>{current=false;window.removeEventListener('focus',read);serviceWorkers.removeEventListener('controllerchange',read);};
  },[snapshot?.revision,snapshot?.publicKey,version,permission]);
  const device=local.state==='subscribed'?snapshot?.devices.find(d=>d.id===local.id):undefined;
  let message='Vérification de cet appareil…';
  if(permission==='denied')message='Autorisation bloquée. Vérifier les notifications du site et celles de Chrome ou de l’application dans Android.';
  else if(permission!=='granted')message='Permission à accorder sur cet appareil pour recevoir des avis.';
  else if(local.state==='inactive')message='Service worker inactif. Rouvrir FamilyHub en ligne et vérifier à nouveau.';
  else if(local.state==='error')message='Lecture de l’abonnement impossible sur cet appareil.';
  else if(local.state==='missing')message='Permission accordée, mais aucun abonnement Push local. Activer sur cet appareil pour le créer.';
  else if(local.state==='subscribed'){
    if(!snapshot)message='Abonnement local présent. Inscription auprès du PC à vérifier après reconnexion.';
    else if(!snapshot.pushConfigured)message='Abonnement local présent. Identité d’envoi du PC indisponible.';
    else if(local.keyMismatch)message='L’abonnement local utilise une autre identité d’envoi. Vérifier la configuration avant de réinscrire cet appareil.';
    else if(!device?.enabled)message='Abonnement local présent, mais aucune inscription active correspondante sur le PC. Vérifier puis réactiver cet appareil.';
    else message='Cet abonnement correspond à une inscription active sur le PC. La réception sur ce téléphone reste à vérifier.';
  }
  return <div role="status"><p>{message}</p>{device?.lastDelivery?.confirmedAt&&<p>Dernière réception déclarée sur cet appareil le {new Date(device.lastDelivery.confirmedAt).toLocaleString('fr-CA')}.</p>}</div>;
}
