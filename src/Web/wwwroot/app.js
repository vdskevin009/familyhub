window.portfolio = {load:key=>localStorage.getItem(key),save:(key,value)=>localStorage.setItem(key,value),download:(name,content,type)=>{const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}};
if ('serviceWorker' in navigator) navigator.serviceWorker.register('service-worker.js',{updateViaCache:'none'}).catch(e=>console.warn('Offline support unavailable',e));
let installEvent;
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installEvent = event; });
window.addEventListener('appinstalled', () => { installEvent = null; });
window.familyhubInstall = { prompt: async () => {
  if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) return 'FamilyHub is already running as an installed app.';
  if (!installEvent) return 'In Chrome or Edge, open the browser menu → Install app or Add to Home screen. On iPhone: Safari → Share → Add to Home Screen. If installation is unavailable, finish loading online and try again.';
  const event = installEvent; installEvent = null; await event.prompt();
  const choice = await event.userChoice;
  return choice.outcome === 'accepted' ? 'Installation requested. Look for FamilyHub on your home screen.' : 'Installation dismissed. You can install later from your browser menu.';
} };
