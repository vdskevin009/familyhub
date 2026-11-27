import type { BlueCrossSyncResult, BlueCrossSyncStatus, InvoiceSnapshot } from "./worker";

const reviewRecords = (count: number) => `${count} insurer record${count === 1 ? " needs" : "s need"} review`;

/** Explain source failures without exposing account addresses or treating saved history as empty. */
export function invoiceCollectionNotice(snapshot: Pick<InvoiceSnapshot, "progress" | "error" | "lastSuccess" | "coverage" | "failure">): string | null {
  const count = snapshot.coverage?.heldMessages;
  const held = typeof count === "number" && Number.isSafeInteger(count) && count > 0 ? count : 0;
  const heldNotice = held ? `Partial collection: ${held} Gmail message${held === 1 ? " needs" : "s need"} review because of unsupported attachments. Check the original documents in Gmail. Saved claims remain available.` : null;
  const authorizationFailures = Object.values(snapshot.progress ?? {}).filter(account =>
    /authorization expired or was rejected|invalid_grant|reconnect this account/i.test(account.error ?? ""));
  if (authorizationFailures.length) return `Gmail sign-in required on the PC for ${authorizationFailures.length} account${authorizationFailures.length === 1 ? "" : "s"}. Recent invoices have not been collected. Reconnect Gmail on the PC, then resume collection. Saved invoices and insurer payments remain available.${snapshot.lastSuccess ? ` Last complete invoice collection: ${snapshot.lastSuccess}.` : ""}${heldNotice ? ` ${heldNotice}` : ""}`;
  if (heldNotice) return snapshot.failure
    ? `${heldNotice} The latest collection was also interrupted. Check Sources.` : heldNotice;
  if (snapshot.failure?.code === "unsupported_attachment") return "Collection interrupted: the connected source cannot read a Gmail attachment. Check the original document in Gmail. Saved claims remain available.";
  return snapshot.error || null;
}

export function insurerSyncMessage(status: BlueCrossSyncStatus | null, result: BlueCrossSyncResult | null, running: boolean): string {
  if (status?.retry?.state === "waiting") return `Collection interrupted. Retrying after a short pause (${status.retry.attempt + 1}/${status.retry.maximum}). Saved claims remain available.`;
  if (running || status?.state === "syncing") return `Reading insurer history${status?.retry ? ` (${status.retry.attempt}/${status.retry.maximum})` : ""}. Saved claims remain available.`;
  if (status?.state === "error") return status.error || "Collection failed. Previously saved claims are unchanged.";
  if (status?.state === "login-required") {
    switch (status.authReason) {
      case "credentials-rejected": return "Sign-in was refused. Automatic retries are paused. Replace the saved login on the PC or use Reconnect.";
      case "human-required": return "Sign-in needs your attention. Use Reconnect on PC to complete verification; collection then resumes.";
      case "not-configured": return "Claims history is unavailable and no automatic login is configured. Review sign-in options on the PC. Saved claims remain available.";
      case "credentials-unavailable": return "Saved login cannot be unlocked. Configure it again as the Windows user running the worker, or use Reconnect.";
      case "layout-changed": return "The insurer page was not recognized, so claims history could not be collected. Review the insurer page on the PC. Saved claims remain available.";
      case "login-incomplete": return "The previous sign-in did not reach verified claims history. Its outcome is uncertain, so automatic sign-in retries are paused. Review the insurer page and recovery options on the PC. Saved claims remain available.";
      case "profile-selection-required": return "The insurer needs an account profile selection on the PC before claims history can be read. Saved claims remain available.";
      case "cooldown": return "Automatic sign-in is cooling down for 30 minutes. You can use Reconnect on PC now.";
      case "profile-busy": return "The insurer profile is unavailable on the PC. Check whether another collection is running or an interrupted lock needs recovery.";
      default: return "Claims history could not be verified. Review the insurer state in Sources on the PC. Saved claims remain available.";
    }
  }
  const current = status?.latestResult ?? result;
  if (current?.status === "login-required") return insurerSyncMessage({ state: "login-required" }, null, false);
  if (current?.status === "success") {
    const counts = `${current.new ?? 0} new · ${current.changed ?? 0} changed · ${current.unchanged ?? 0} unchanged`;
    if (current.autoImported != null) {
      if (current.complete && current.ambiguous && !current.errors) return `Automatic import paused: collection complete; ${reviewRecords(current.ambiguous)}. ${current.autoImported} new insurer records saved. Existing saved payments remain available.`;
      if (!current.complete || current.ambiguous || current.errors) return `Automatic import paused: collection is incomplete or ambiguous. ${current.autoImported} new insurer records saved; review the insurer history.`;
      const pending = (current.pendingNew ?? 0) + (current.pendingChanged ?? 0);
      return pending
        ? `Saved ${current.autoImported} new insurer records automatically. ${pending} insurer records still need review; Apply saves only after review.`
        : current.autoImported
          ? `Saved ${current.autoImported} new insurer records automatically in FamilyHub. Claims are refreshed.`
          : `Up to date: ${current.unchanged ?? 0} insurer records already saved.`;
    }
    if (current.applied) return `Saved in FamilyHub: ${counts}. View DJ/BC and Reimbursements → All or Closed.`;
    if (!current.complete || current.ambiguous || current.errors) return `Preview: ${counts}. Review incomplete or ambiguous records before applying.`;
    if (!current.new && !current.changed) return `Up to date: ${current.unchanged ?? 0} insurer records already saved.`;
    return `Preview: ${counts}. Apply to save these changes in FamilyHub.`;
  }
  if (status?.state === "up-to-date") return `Up to date · ${status.found ?? 0} insurer records. View DJ/BC and Reimbursements → All or Closed.`;
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

type InsurerCoverage = { summary: string; notice: string };

/** Keep the compact caption and disclosed evidence on the same source-state rules. */
function insurerCoverage(status: BlueCrossSyncStatus | null, now: number): InsurerCoverage | null {
  if (!status) return { summary: "status unavailable", notice: "Collection status unavailable. Saved claims may be missing recent payments." };
  if (status.state === "syncing") return { summary: status.retry?.state === "waiting" ? "retry scheduled" : "collection in progress", notice: insurerSyncMessage(status, null, true) };
  if (status.state === "login-required") {
    if (status.authReason === "layout-changed" || status.authReason === "login-incomplete" || !status.authReason)
      return { summary: status.authReason === "login-incomplete" ? "sign-in not confirmed" : "history unavailable", notice: "Insurer history unavailable. Recent payments may be missing; review Sources on the PC." };
    if (status.authReason === "profile-selection-required") return { summary: "select a profile on the PC", notice: "Account profile selection required on the PC. Recent payments may be missing." };
    if (status.authReason === "profile-busy") return { summary: "profile in use on the PC", notice: "The insurer profile is unavailable on the PC. Recent payments have not yet been verified; review Sources and check whether another collection or an interrupted lock is using the profile." };
    if (status.authReason === "cooldown") return { summary: "sign-in paused", notice: "Automatic sign-in is paused during its cooldown. Recent payments may be missing; review Sources on the PC." };
    const summary = status.authReason === "credentials-rejected" ? "sign-in rejected"
      : status.authReason === "human-required" ? "verification required on the PC"
      : status.authReason === "not-configured" ? "sign-in not configured"
      : status.authReason === "credentials-unavailable" ? "saved access unavailable" : null;
    return summary ? { summary, notice: "Sign-in required. Recent payments may be missing; review Sources on the PC." }
      : { summary: "history unavailable", notice: "Insurer history unavailable. Recent payments may be missing; review Sources on the PC." };
  }
  const completeWithReview = !!status.latestResult?.complete && !!status.latestResult.ambiguous && !status.latestResult.errors;
  if (status.state === "error" && !completeWithReview || status.latestResult && (!status.latestResult.complete || status.latestResult.errors))
    return { summary: "incomplete collection", notice: status.retry?.state === "exhausted" ? `Collection stopped after ${status.retry.maximum} attempts. Recent payments may be missing; review Sources and retry.` : "Collection incomplete. Recent payments may be missing; review Sources." };
  if (!status.lastSuccess || !Number.isFinite(Date.parse(status.lastSuccess))) return { summary: "complete collection not confirmed", notice: "No complete insurer collection recorded. Saved claims may be incomplete." };
  if (now - Date.parse(status.lastSuccess) > 36 * 60 * 60_000) return { summary: "data out of date", notice: "Insurer collection is out of date. Recent payments may be missing; update Sources." };
  if (completeWithReview) return { summary: "matches to review", notice: `Collection complete; ${reviewRecords(status.latestResult!.ambiguous!)} before matching. Previously saved payments remain available.` };
  if (status.latestResult && !status.latestResult.applied && ((status.latestResult.pendingNew ?? status.latestResult.new ?? 0) + (status.latestResult.pendingChanged ?? status.latestResult.changed ?? 0)))
    return { summary: "results to review", notice: "Collected insurer records still need review and Apply. Previously saved payments remain available." };
  return null;
}

export function insurerCoverageNotice(status: BlueCrossSyncStatus | null, now = Date.now()): string | null {
  return insurerCoverage(status, now)?.notice ?? null;
}

export function insurerCoverageSummary(status: BlueCrossSyncStatus | null, now = Date.now()): string | null {
  return insurerCoverage(status, now)?.summary ?? null;
}
