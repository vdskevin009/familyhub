import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkerConfig } from "./types";
import type { FinanceSourceInventory } from "../../worker/src/finance-source-inventory-model";
import { fetchFinanceSourceInventory } from "./worker";

type InventoryRead = { scope: string; status: "loading" | "ready" | "unsupported" | "error"; snapshot: FinanceSourceInventory | null };
/** Independent read lifecycle: an unavailable inventory cannot clear or replace the canonical ledger. */
export function useFinanceSourceInventory(config: WorkerConfig) {
  const scope = JSON.stringify([config.Endpoint, config.ApiKey]), currentScope = useRef(scope), generation = useRef(0);
  currentScope.current = scope;
  const [result, setResult] = useState<InventoryRead>({ scope, status: "loading", snapshot: null });
  const reload = useCallback(async () => {
    const request = ++generation.current;
    if (!config.Endpoint || !config.ApiKey) { setResult({ scope, status: "unsupported", snapshot: null }); return; }
    setResult({ scope, status: "loading", snapshot: null });
    try {
      const value = await fetchFinanceSourceInventory(config);
      if (generation.current === request && currentScope.current === scope) setResult({ scope, status: value === null ? "unsupported" : "ready", snapshot: value?.snapshot ?? null });
    } catch {
      if (generation.current === request && currentScope.current === scope) setResult({ scope, status: "error", snapshot: null });
    }
  }, [config.Endpoint, config.ApiKey, scope]);
  useEffect(() => { void reload(); return () => { generation.current++; }; }, [reload]);
  return { ...(result.scope === scope ? result : { scope, status: "loading" as const, snapshot: null }), reload };
}
