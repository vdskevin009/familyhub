import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkerConfig } from "./types";
import type { SourceExpensesSnapshot } from "../../worker/src/finance-source-expenses-model";
import { fetchSourceExpenses } from "./worker";

type ExpensesRead = { scope: string; status: "loading" | "ready" | "unsupported" | "error"; snapshots: SourceExpensesSnapshot[] };
/** Independent read lifecycle: an unavailable inventory cannot clear or replace the canonical ledger. */
export function useSourceExpenses(config: WorkerConfig) {
  const scope = JSON.stringify([config.Endpoint, config.ApiKey]), currentScope = useRef(scope), generation = useRef(0);
  currentScope.current = scope;
  const [result, setResult] = useState<ExpensesRead>({ scope, status: "loading", snapshots: [] });
  const reload = useCallback(async () => {
    const request = ++generation.current;
    if (!config.Endpoint || !config.ApiKey) { setResult({ scope, status: "unsupported", snapshots: [] }); return; }
    setResult({ scope, status: "loading", snapshots: [] });
    try {
      const value = await fetchSourceExpenses(config);
      if (generation.current === request && currentScope.current === scope) setResult({ scope, status: value === null ? "unsupported" : "ready", snapshots: value?.snapshots ?? [] });
    } catch {
      if (generation.current === request && currentScope.current === scope) setResult({ scope, status: "error", snapshots: [] });
    }
  }, [config.Endpoint, config.ApiKey, scope]);
  useEffect(() => { void reload(); return () => { generation.current++; }; }, [reload]);
  return { ...(result.scope === scope ? result : { scope, status: "loading" as const, snapshots: [] }), reload };
}
