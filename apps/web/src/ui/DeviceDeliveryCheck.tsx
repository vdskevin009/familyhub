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
  let message='Checking this device…';
  if(permission==='denied')message='Permission is blocked. Check site notifications and Chrome or app notifications in Android.';
  else if(permission!=='granted')message='Allow notifications on this device to receive alerts.';
  else if(local.state==='inactive')message='The service worker is inactive. Open FamilyHub while online and check again.';
  else if(local.state==='error')message='The subscription could not be read on this device.';
  else if(local.state==='missing')message='Permission granted, but there is no local Push subscription. Enable notifications on this device to create one.';
  else if(local.state==='subscribed'){
    if(!snapshot)message='A local subscription exists. Reconnect to your PC to verify its registration.';
    else if(!snapshot.pushConfigured)message='A local subscription exists. Your PC’s sending identity is unavailable.';
    else if(local.keyMismatch)message='The local subscription uses a different sending identity. Check the configuration before registering this device again.';
    else if(!device?.enabled)message='A local subscription exists, but there is no matching active PC registration. Check and re-enable this device.';
    else message='This subscription matches an active registration on the PC. Receipt on this phone still needs confirmation.';
  }
  return <div role="status"><p>{message}</p>{device?.lastDelivery?.confirmedAt&&<p>Last confirmed receipt on this device: {new Date(device.lastDelivery.confirmedAt).toLocaleString('en-CA')}.</p>}</div>;
}
