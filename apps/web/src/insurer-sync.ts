import type { BlueCrossSyncResult, BlueCrossSyncStatus } from "./worker";

export function insurerSyncMessage(status: BlueCrossSyncStatus | null, result: BlueCrossSyncResult | null, running: boolean): string {
  if (running || status?.state === "syncing") return "Reading insurer history… Saved claims remain available.";
  if (status?.state === "error") return status.error || "Collection failed. Previously saved claims are unchanged.";
  if (status?.state === "login-required") return "Session expired. Reconnect on PC to sign in again.";
  const current = status?.latestResult ?? result;
  if (current?.status === "login-required") return "Session expired. Reconnect on PC to sign in again.";
  if (current?.status === "success") {
    const counts = `${current.new ?? 0} new · ${current.changed ?? 0} changed · ${current.unchanged ?? 0} unchanged`;
    if (current.applied) return `Saved in FamilyHub: ${counts}. View DJ/BC and Claims → All or Closed.`;
    if (!current.complete || current.ambiguous || current.errors) return `Preview: ${counts}. Review incomplete or ambiguous records before applying.`;
    if (!current.new && !current.changed) return `Up to date: ${current.unchanged ?? 0} insurer records already saved.`;
    return `Preview: ${counts}. Apply to save these changes in FamilyHub.`;
  }
  if (status?.state === "up-to-date") return `Up to date · ${status.found ?? 0} insurer records. View DJ/BC and Claims → All or Closed.`;
  return status?.lastSuccess ? `Preview available · ${status.found ?? 0} insurer records.` : "No insurer history collected yet.";
}

export function applicableInsurerPreview(status: BlueCrossSyncStatus | null, result: BlueCrossSyncResult | null): boolean {
  if (status && ["syncing", "error", "login-required"].includes(status.state)) return false;
  const current = status?.latestResult ?? result;
  return current?.status === "success" && !!current.complete && !current.applied && !current.ambiguous && !current.errors
    && !!((current.new ?? 0) + (current.changed ?? 0));
}
