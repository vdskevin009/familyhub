import { useCallback, useEffect, useRef, useState } from "react";
import type { FinanceAccountCapture } from "../../worker/src/finance-account-captures-model";
import type { WorkerConfig } from "./types";
import { fetchFinanceAccountCaptures } from "./worker";
export type AccountCaptureRead = { scope: string; status: "loading" | "ready" | "unsupported" | "error"; captures: FinanceAccountCapture[] };
/** No private caching or stale display; superseded requests cannot update the selected worker scope. */
export function useFinanceAccountCaptures(config: WorkerConfig) {
  const scope = JSON.stringify([config.Endpoint, config.ApiKey]), currentScope = useRef(scope), generation = useRef(0);
  currentScope.current = scope;
  const [result, setResult] = useState<AccountCaptureRead>({ scope, status: "loading", captures: [] });
  const reload = useCallback(async () => {
    const request = ++generation.current;
    if (!config.Endpoint || !config.ApiKey) { setResult({ scope, status: "unsupported", captures: [] }); return; }
    setResult({ scope, status: "loading", captures: [] });
    try {
      const value = await fetchFinanceAccountCaptures(config);
      if (request === generation.current && currentScope.current === scope) setResult({ scope, status: value === null ? "unsupported" : "ready", captures: value?.captures ?? [] });
    } catch { if (request === generation.current && currentScope.current === scope) setResult({ scope, status: "error", captures: [] }); }
  }, [config.Endpoint, config.ApiKey, scope]);
  useEffect(() => { void reload(); return () => { generation.current++; }; }, [reload]);
  return { ...(result.scope === scope ? result : { scope, status: "loading" as const, captures: [] }), reload };
}
