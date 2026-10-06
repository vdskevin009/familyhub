import type { BlueCrossSyncResult, BlueCrossSyncStatus } from "./worker";

export function insurerSyncMessage(status: BlueCrossSyncStatus | null, result: BlueCrossSyncResult | null, running: boolean): string {
  if (running || status?.state === "syncing") return "Reading insurer history… Saved claims remain available.";
  if (status?.state === "error") return status.error || "Collection failed. Previously saved claims are unchanged.";
  if (status?.state === "login-required") {
    switch (status.authReason) {
      case "credentials-rejected": return "Sign-in was refused. Automatic retries are paused. Replace the saved login on the PC or use Reconnect.";
      case "human-required": return "Sign-in needs your attention. Use Reconnect on PC to complete verification; collection then resumes.";
      case "not-configured": return "Session expired. Set up automatic login on the PC, or use Reconnect to sign in.";
      case "credentials-unavailable": return "Saved login cannot be unlocked. Configure it again as the Windows user running the worker, or use Reconnect.";
      case "layout-changed": return "The sign-in page was not recognized. Use Reconnect on PC to continue manually.";
      case "cooldown": return "Automatic sign-in is cooling down for 30 minutes. You can use Reconnect on PC now.";
      case "profile-busy": return "This insurer is already open in another collection. Wait for it to finish; recover an interrupted lock on the PC if needed.";
      default: return "Session expired. Reconnect on PC to sign in again.";
    }
  }
  const current = status?.latestResult ?? result;
  if (current?.status === "login-required") return "Session expired. Reconnect on PC to sign in again.";
  if (current?.status === "success") {
    const counts = `${current.new ?? 0} new · ${current.changed ?? 0} changed · ${current.unchanged ?? 0} unchanged`;
    if (current.autoImported != null) {
      if (!current.complete || current.ambiguous || current.errors) return `Automatic import paused: collection is incomplete or ambiguous. ${current.autoImported} new payments saved; review the insurer history.`;
      const pending = (current.pendingNew ?? 0) + (current.pendingChanged ?? 0);
      return pending
        ? `Saved ${current.autoImported} new payments automatically. ${pending} insurer records still need review; Apply saves only after review.`
        : current.autoImported
          ? `Saved ${current.autoImported} new payments automatically in FamilyHub. Claims are refreshed.`
          : `Up to date: ${current.unchanged ?? 0} insurer records already saved.`;
    }
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
    && !!((current.pendingNew ?? current.new ?? 0) + (current.pendingChanged ?? current.changed ?? 0));
}

export function insurerCollectionNeedsRefresh(result: BlueCrossSyncResult, explicitlyApplied = false): boolean {
  return result.status === "success" && (explicitlyApplied || result.applied === true || (result.autoImported ?? 0) > 0);
}
