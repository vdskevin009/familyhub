import { useEffect, useRef, useState } from "react";
import type { HubState } from "./state";
import { baselineKey, type SavingsContract } from "./savings";
import { contractSignature, mergeSharedContracts, type SharedContract, type SharedLibrary } from "../../worker/src/savings-sharing-model";
import { fetchSharedSavings, fetchSharedSavingsDocument, importSharedSavings, updateSharedSavings } from "./worker";
import { exportContractDocuments, restoreContractDocuments, hasContractDocument } from "./contract-documents";
import { useStoredState } from "./storage";
import { fetchSharedResearch, type SharedResearch } from "./worker";
import { prepareSharedReviews, mergeResearchReviews } from "./savings-results";

export function useSavingsSharing(hub: HubState) {
  const [known, setKnown] = useStoredState<Record<string, string>>("familyhub.savings.shared.v1", {});
  const knownRef = useRef(known), localRef = useRef(hub.savings.Contracts ?? []), sharedRef = useRef<Record<string, SharedContract>>({});
  const [busy, setBusy] = useState(false), [status, setStatus] = useState(""), [error, setError] = useState("");
  const busyRef = useRef(false), generation = useRef(0);
  const [research, setResearch] = useState<SharedResearch | null>(null), [researchError, setResearchError] = useState("");
  localRef.current = hub.savings.Contracts ?? []; knownRef.current = known;
  const paired = Boolean(hub.worker.Endpoint && hub.worker.ApiKey);
  async function accept(library: SharedLibrary, currentGeneration: number) {
    if (!Array.isArray(library.records)) throw new Error("Phone sharing needs PC worker 2.20.0 or later. Update the existing FamilyHub PC worker.");
    if (currentGeneration !== generation.current) return;
    const merged = mergeSharedContracts(localRef.current, library.records, knownRef.current);
    let missingDocuments = 0;
    for (const record of library.records) {
      if (merged.conflicts.includes(record.contract.id)) continue;
      for (const document of record.contract.documents) {
        if (await hasContractDocument(document.id)) continue;
        try {
          const bytes = await fetchSharedSavingsDocument(hub.worker, document.id);
          if (currentGeneration !== generation.current) return;
          await restoreContractDocuments([bytes]);
        } catch { missingDocuments++; }
      }
    }
    if (currentGeneration !== generation.current) return;
    // Recompute after network awaits, preserving any intervening local edit.
    const latest = mergeSharedContracts(localRef.current, library.records, knownRef.current);
    hub.setSavings(previous => ({ ...previous, Contracts: mergeSharedContracts(previous.Contracts ?? [], library.records, knownRef.current).contracts }));
    setKnown(latest.signatures); knownRef.current = latest.signatures;
    sharedRef.current = Object.fromEntries(library.records.map(record => [record.contract.id, record]));
    const conflicts = new Set([...(library.conflicts ?? []), ...latest.conflicts]);
    setStatus(`${library.records.length} shared contracts available on paired devices.`);
    setError(conflicts.size ? `${conflicts.size} contract versions differ. Both versions are preserved; local edits were not replaced. Review the shared version before saving further changes.` : missingDocuments ? `Contracts loaded, but ${missingDocuments} documents could not be downloaded. Refresh shared contracts when your PC is reachable.` : "");
    try {
      const shared = await fetchSharedResearch(hub.worker);
      const incoming = await prepareSharedReviews(shared.jobs, latest.contracts);
      if (currentGeneration !== generation.current) return;
      setResearch(shared); setResearchError("");
      hub.setSavings(previous => ({ ...previous, Reviews: mergeResearchReviews(previous.Reviews ?? [], incoming.filter(review => previous.Contracts?.some(contract => contract.id === review.job.contractId && baselineKey(contract) === review.localKey))) }));
    } catch { if (currentGeneration === generation.current) setResearchError("Saved comparisons remain available. Daily research status could not be loaded; update the PC worker to 2.21.0 and refresh."); }
  }
  async function run(action: () => Promise<SharedLibrary>) {
    if (busyRef.current) return false;
    busyRef.current = true; setBusy(true); setError(""); const currentGeneration = generation.current;
    try { await accept(await action(), currentGeneration); return true; }
    catch (err) { if (currentGeneration === generation.current) setError(err instanceof Error ? err.message : "Could not reach your PC. Saved contracts remain on this device."); return false; }
    finally { if (currentGeneration === generation.current) { busyRef.current = false; setBusy(false); } }
  }
  const refresh = () => run(() => fetchSharedSavings(hub.worker));
  const share = () => run(async () => {
    const contracts = localRef.current;
    const documents = await exportContractDocuments(contracts.flatMap(contract => contract.documents));
    return importSharedSavings(hub.worker, contracts, documents);
  });
  const update = (contract: SavingsContract, revision: string) => run(async () => {
    const documents = await exportContractDocuments(contract.documents);
    return updateSharedSavings(hub.worker, contract, revision, documents);
  });
  const revisionFor = (contract: SavingsContract) => {
    const shared = sharedRef.current[contract.id];
    return shared && contractSignature(shared.contract) === contractSignature(contract) ? shared.revision : null;
  };
  useEffect(() => {
    generation.current++; sharedRef.current = {}; busyRef.current = false; setBusy(false); setStatus(""); setError(""); setResearch(null); setResearchError("");
    const currentGeneration = generation.current;
    if (paired) void Promise.resolve().then(() => { if (currentGeneration === generation.current) return refresh(); });
    return () => { generation.current++; };
  }, [hub.worker.Endpoint, hub.worker.ApiKey]);
  return { paired, busy, status, error, refresh, share, update, revisionFor, research, researchError };
}
