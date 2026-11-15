import { useEffect, useState } from "react";
import type { WorkerConfig } from "./types";
import type { FinanceRegisterProof } from "../../worker/src/finance-register-bindings";
import { fetchFinanceRegisterBindings } from "./worker";

export function useFinanceRegisterBindings(config: WorkerConfig, revision: string | undefined) {
  const scope = JSON.stringify([config.Endpoint, config.ApiKey, revision]);
  const [attempt,setAttempt] = useState(0);
  const [read, setRead] = useState<{ scope: string; value: FinanceRegisterProof | null; status: "loading" | "ready" | "unsupported" | "error" }>({ scope, value: null, status: "loading" });
  useEffect(() => {
    let cancelled = false;
    setRead({ scope, value: null, status: "loading" });
    if (!config.Endpoint || !config.ApiKey) { setRead({ scope, value: null, status: "unsupported" }); return; }
    void fetchFinanceRegisterBindings(config).then(value => { if (!cancelled) setRead({ scope, value, status: value ? "ready" : "unsupported" }); }).catch(() => { if (!cancelled) setRead({ scope, value: null, status: "error" }); });
    return () => { cancelled = true; };
  }, [scope,attempt]);
  return {...(read.scope === scope ? read : { scope, value: null, status: "loading" as const }),reload:()=>setAttempt(n=>n+1)};
}
