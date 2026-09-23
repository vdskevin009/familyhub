import { ReimbursementItem, ReimbursementStatus } from "./types";

function autoTriageKnownItem(item: ReimbursementItem): ReimbursementItem {
  if (item.ClassificationSource === "manual") return item;
  const sender = item.Sender.toLowerCase();
  const subject = item.Subject.trim();
  const ignored = sender.includes("notifications@github.com")
    || (sender.includes("janeapp.com") && /^(?:appointment reminder|thanks for booking)$/i.test(subject))
    || (sender.includes("teeon.com") && /booking confirmation/i.test(subject))
    || (sender.includes("communication.microsoft.com") && /terms of use/i.test(subject));
  const administrative = (sender.includes("revolut.com") && /(?:trading t&cs|terms and conditions|t&cs)/i.test(subject))
    || (sender.includes("td.com") && /statement.*available/i.test(subject))
    || sender.includes("crelan.be")
    || (sender.includes("notifications.westjet.com") && /travel with ease/i.test(subject));
  if (!ignored && !administrative) return item;
  const reason = ignored ? "Routine notification filtered from the document queue." : "Administrative notice recognized from sender and subject.";
  return {
    ...item,
    DocumentType: ignored ? "ignore" : "administrative",
    Status: ignored ? ReimbursementStatus.Ignored : ReimbursementStatus.ToReview,
    NeedsReview: false,
    ReimbursementEligibility: "no",
    ClassificationSource: "rules",
    Reasons: [reason, ...(item.Reasons ?? [])].slice(0, 3)
  };
}

export function mergeInvoiceItems(existing: ReimbursementItem[], incoming: ReimbursementItem[]): ReimbursementItem[] {
  const map = new Map(existing.map(item => [`${item.AccountEmail.toLowerCase()}:${item.SourceMessageId}`, item]));
  for (const incomingItem of incoming) {
    const next = autoTriageKnownItem(incomingItem);
    const key = `${next.AccountEmail.toLowerCase()}:${next.SourceMessageId}`;
    const current = map.get(key);
    if (current?.WorkerManaged && !next.WorkerManaged) continue;
    map.set(key, current ? {
      ...next,
      Id: next.WorkerManaged ? next.Id : current.Id,
      Status: next.WorkerManaged && (current.WorkerManaged || next.Status === ReimbursementStatus.Ignored) ? next.Status : current.Status,
      Notes: current.Notes,
      DriveFileId: current.DriveFileId,
      DrivePath: current.DrivePath,
      ArchivedAt: current.ArchivedAt
    } : next);
  }
  return [...map.values()];
}
