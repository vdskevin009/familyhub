import { useCallback, useEffect, useRef, useState } from "react";
import type { FinanceHistoricalAccountVersion } from "../../worker/src/finance-account-history-model";
import type { WorkerConfig } from "./types";
import { fetchFinanceAccountHistory } from "./worker";
export type AccountHistoryRead = { scope: string; status: "loading" | "ready" | "unsupported" | "error"; versions: FinanceHistoricalAccountVersion[]; unavailableArchiveCount: number };
export function useFinanceAccountHistory(config: WorkerConfig) {
  const scope = JSON.stringify([config.Endpoint, config.ApiKey]), currentScope = useRef(scope), generation = useRef(0);
  currentScope.current = scope;
  const [result, setResult] = useState<AccountHistoryRead>({ scope, status: "loading", versions: [], unavailableArchiveCount: 0 });
  const reload = useCallback(async () => {
    const request = ++generation.current;
    if (!config.Endpoint || !config.ApiKey) { setResult({ scope, status: "unsupported", versions: [], unavailableArchiveCount: 0 }); return; }
    setResult({ scope, status: "loading", versions: [], unavailableArchiveCount: 0 });
    try {
      const value = await fetchFinanceAccountHistory(config);
      if (request === generation.current && currentScope.current === scope) setResult({ scope, status: value === null ? "unsupported" : "ready", versions: value?.versions ?? [], unavailableArchiveCount: value?.unavailableArchiveCount ?? 0 });
    } catch { if (request === generation.current && currentScope.current === scope) setResult({ scope, status: "error", versions: [], unavailableArchiveCount: 0 }); }
  }, [config.Endpoint, config.ApiKey, scope]);
  useEffect(() => { void reload(); return () => { generation.current++; }; }, [reload]);
  return { ...(result.scope === scope ? result : { scope, status: "loading" as const, versions: [], unavailableArchiveCount: 0 }), reload };
}
