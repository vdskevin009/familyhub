import { createHash } from "node:crypto";
import type { Correction, Invoice } from "./invoice-model.js";

export type ReconciliationCase = {
  Id: string;
  Member: "Kevin" | "Jasmine" | "unknown";
  Provider: string;
  ServiceDate: string | null;
  OriginalAmount: number | null;
  ReimbursedAmount: number;
  PotentialRemaining: number | null;
  Currency: string;
  NextInsurer: "Desjardins" | "Blue Cross" | null;
  Action: "review-amount" | "submit-primary" | "submit-secondary" | "verify-balance" | "complete";
  Summary: string;
  Confidence: number;
  DocumentIds: string[];
};

export type CleanupSuggestion = {
  Fingerprint: string;
  Sender: string;
  Subject: string;
  Seen: number;
  Confidence: number;
  Action: "review" | "ignore-in-familyhub" | "unsubscribe-with-confirmation";
  Reason: string;
};

const insurerOrder = (member: ReconciliationCase["Member"]): Array<"desjardins" | "blue-cross"> =>
  member === "Jasmine" ? ["blue-cross", "desjardins"] : ["desjardins", "blue-cross"];
const insurerName = (value: "desjardins" | "blue-cross"): "Desjardins" | "Blue Cross" => value === "desjardins" ? "Desjardins" : "Blue Cross";
const day = (value: string | null | undefined): number => value ? Date.parse(value.slice(0, 10)) / 86_400_000 : Number.NaN;
const providerKey = (value: string): string => value.toLowerCase().replace(/desjardins|blue cross|croix bleue|insurance|assurance/g, "").replace(/[^a-z0-9]+/g, " ").trim();

function likelyMatch(expense: Invoice, statement: Invoice): boolean {
  if (expense.Member !== "unknown" && statement.Member !== "unknown" && expense.Member !== statement.Member) return false;
  const dateDistance = Math.abs(day(expense.ServiceDate || expense.ReceivedAt) - day(statement.ServiceDate || statement.ReceivedAt));
  const amount = expense.BilledAmount ?? expense.DetectedAmount;
  const paid = statement.ReimbursedAmount ?? statement.DetectedAmount;
  const providerMatches = providerKey(expense.Provider).length > 3 && providerKey(statement.Subject + " " + statement.Provider).includes(providerKey(expense.Provider));
  return (dateDistance <= 14 || providerMatches) && !(amount != null && paid != null && paid > amount * 1.05);
}

export function buildReconciliations(items: Invoice[]): ReconciliationCase[] {
  const usable = items.filter(item => item.Category === 0 && item.Status !== 4 && !item.NeedsReview);
  const expenses = usable.filter(item => item.DocumentRole === "expense" || (!item.DocumentRole && item.DocumentType !== "claim"));
  const statements = usable.filter(item => item.DocumentRole === "insurer-statement" || item.DocumentType === "claim");
  const used = new Set<string>();
  const cases = expenses.map(expense => {
    const matched = statements.filter(statement => !used.has(statement.Id) && likelyMatch(expense, statement));
    matched.forEach(statement => used.add(statement.Id));
    const original = expense.BilledAmount ?? expense.DetectedAmount;
    const reimbursed = matched.reduce((sum, item) => sum + (item.ReimbursedAmount ?? item.DetectedAmount ?? 0), 0);
    const remaining = original == null ? null : Math.max(0, Math.round((original - reimbursed) * 100) / 100);
    const member = expense.Member || "unknown";
    const order = insurerOrder(member);
    const seen = new Set(matched.map(item => item.Insurer).filter(Boolean));
    let action: ReconciliationCase["Action"] = "complete";
    let next: ReconciliationCase["NextInsurer"] = null;
    let summary = "Documents rapprochés; aucun solde potentiel détecté.";
    if (original == null) { action = "review-amount"; summary = "Montant de la facture à confirmer avant le rapprochement."; }
    else if (!seen.has(order[0])) { action = "submit-primary"; next = insurerName(order[0]); summary = `Vérifier ou soumettre cette dépense à ${next}.`; }
    else if (remaining! > 0 && !seen.has(order[1])) { action = "submit-secondary"; next = insurerName(order[1]); summary = `${remaining!.toFixed(2)} $ reste à vérifier auprès de ${next}; ce montant n'est pas garanti.`; }
    else if (remaining! > 0) { action = "verify-balance"; summary = `${remaining!.toFixed(2)} $ reste à charge potentiel après les relevés trouvés.`; }
    return {
      Id: createHash("sha256").update(expense.Id + matched.map(item => item.Id).sort().join(":" )).digest("hex").slice(0, 24),
      Member: member, Provider: expense.Provider, ServiceDate: expense.ServiceDate,
      OriginalAmount: original, ReimbursedAmount: reimbursed, PotentialRemaining: remaining,
      Currency: expense.Currency || "CAD", NextInsurer: next, Action: action, Summary: summary,
      Confidence: matched.length ? Math.min(expense.Confidence, ...matched.map(item => item.Confidence)) : expense.Confidence,
      DocumentIds: [expense.Id, ...matched.map(item => item.Id)]
    };
  });
  return cases.sort((a, b) => Number(a.Action === "complete") - Number(b.Action === "complete") || (b.PotentialRemaining ?? 0) - (a.PotentialRemaining ?? 0));
}

export function buildCleanupSuggestions(items: Invoice[], corrections: Correction[]): CleanupSuggestion[] {
  const groups = new Map<string, Invoice[]>();
  for (const item of items.filter(item => item.DocumentType === "marketing" || item.DocumentType === "ignore")) {
    const list = groups.get(item.Fingerprint) ?? []; list.push(item); groups.set(item.Fingerprint, list);
  }
  return [...groups.entries()].map(([fingerprint, matches]): CleanupSuggestion => {
    const learned = corrections.filter(item => item.fingerprint === fingerprint).reduce((sum, item) => sum + (item.confirmations ?? 1), 0);
    const seen = Math.max(matches.length, learned);
    const confidence = seen >= 3 ? 98 : seen === 2 ? 88 : 70;
    const canSuggestUnsubscribe = matches.some(item => item.HasUnsubscribe);
    const action: CleanupSuggestion["Action"] = seen >= 3 ? (canSuggestUnsubscribe ? "unsubscribe-with-confirmation" : "ignore-in-familyhub") : "review";
    return {
      Fingerprint: fingerprint, Sender: matches[0].Sender, Subject: matches[0].Subject, Seen: seen, Confidence: confidence,
      Action: action,
      Reason: seen >= 3 ? "Même décision répétée; FamilyHub peut filtrer automatiquement. Le désabonnement exige toujours votre confirmation." : "FamilyHub attend des décisions répétées avant d'agir automatiquement."
    };
  }).sort((a, b) => b.Confidence - a.Confidence);
}
