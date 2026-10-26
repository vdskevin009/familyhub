import { useEffect, useState } from "react";
import type { WorkerConfig } from "../types";
import { fetchMortgage } from "../mortgage-api";
import { emptyMortgage, localDate } from "../../../worker/src/mortgage-model";
import MortgageAssistant, { type MortgageAssistantState } from "./MortgageAssistant";
import MortgageCompactView from "./MortgageCompactView";
import { saveMortgageAlertSettings } from "../mortgage-assistant-api";

export default function MortgageView({worker}:{worker:WorkerConfig}) {
  const [state,setState]=useState<MortgageAssistantState>(emptyMortgage),[busy,setBusy]=useState(true),[error,setError]=useState(""),[reload,setReload]=useState(0),[readVersion,setReadVersion]=useState(0),[today,setToday]=useState(()=>localDate(new Date()));
  useEffect(()=>{const timer=setInterval(()=>setToday(localDate(new Date())),30000),refresh=setInterval(()=>setReload(n=>n+1),300000);return()=>{clearInterval(timer);clearInterval(refresh);};},[]);
  useEffect(()=>{const controller=new AbortController();setBusy(true);setError("");setState(emptyMortgage());void fetchMortgage(worker,controller.signal).then(s=>{if(!controller.signal.aborted){setState(s);setReadVersion(n=>n+1);}}).catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});return()=>controller.abort();},[worker.Endpoint,worker.ApiKey,reload]);
  return <MortgageAssistant readVersion={readVersion} state={state} busy={busy} error={error} today={today} onRefresh={()=>setReload(n=>n+1)} offers={onCompare=><MortgageCompactView worker={worker} data={state} isLoading={busy} loadError={error} onRefresh={()=>setReload(n=>n+1)} onCompareOffer={onCompare}/>} onSaveSettings={async settings=>{await saveMortgageAlertSettings(worker,settings);setReload(n=>n+1);}}/>;
}
