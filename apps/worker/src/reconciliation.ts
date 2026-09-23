import { createHash } from "node:crypto";
import type { Correction, Invoice } from "./invoice-model.js";

export type ReconciliationCase = {
  Id: string;
  Member: "Kevin" | "Jasmine" | "unknown";
  Provider: string;
  ServiceDate: string | null;
  OriginalAmount: number | null;
  ReimbursedAmount: number;
  PrimaryInsurer: "Desjardins" | "Blue Cross" | null;
  PrimaryReimbursedAmount: number;
  SecondaryInsurer: "Desjardins" | "Blue Cross" | null;
  SecondaryReimbursedAmount: number;
  PotentialRemaining: number | null;
  Currency: string;
  NextInsurer: "Desjardins" | "Blue Cross" | null;
  Action: "review-amount" | "submit-primary" | "submit-secondary" | "verify-balance" | "complete";
  Status: "fully-reimbursed" | "waiting-primary" | "waiting-secondary" | "needs-attention";
  Summary: string;
  Confidence: number;
  DocumentIds: string[];
};

export type UnmatchedReimbursement = {
  DocumentId: string;
  Reason: "ambiguous-match" | "missing-insurer" | "needs-review" | "no-expense-match";
};

export type ReconciliationSnapshot = {
  cases: ReconciliationCase[];
  unmatched: UnmatchedReimbursement[];
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

function matchScore(expense: Invoice, statement: Invoice): number {
  if (expense.Member !== "unknown" && statement.Member !== "unknown" && expense.Member !== statement.Member) return -1;
  if (!statement.Insurer || statement.NeedsReview || expense.NeedsReview) return -1;
  const amount = expense.BilledAmount ?? expense.DetectedAmount;
  const paid = statement.ReimbursedAmount ?? statement.DetectedAmount;
  if (amount != null && paid != null && paid > amount * 1.05) return -1;

  let score = 0;
  if (expense.Member !== "unknown" && expense.Member === statement.Member) score += 3;
  const expenseDay = day(expense.ServiceDate);
  const statementDay = day(statement.ServiceDate);
  if (Number.isFinite(expenseDay) && Number.isFinite(statementDay)) {
    const distance = Math.abs(expenseDay - statementDay);
    if (distance === 0) score += 5;
    else if (distance <= 3) score += 4;
    else if (distance <= 14) score += 2;
  }
  const expenseProvider = providerKey(expense.Provider);
  const statementText = providerKey(`${statement.Subject} ${statement.Provider}`);
  if (expenseProvider.length > 3 && statementText.includes(expenseProvider)) score += 4;
  if (amount != null && paid != null) score += 1;
  if (Math.min(expense.Confidence, statement.Confidence) >= 90) score += 1;
  return score;
}

export function buildReconciliationSnapshot(items: Invoice[]): ReconciliationSnapshot {
  const health = items.filter(item => item.Category === 0 && item.Status !== 4);
  const expenses = health.filter(item => item.DocumentRole === "expense"
    || ((!item.DocumentRole || item.DocumentRole === "other") && ["receipt", "invoice", "bill"].includes(item.DocumentType)));
  const statements = health.filter(item => item.DocumentRole === "insurer-statement" || item.DocumentType === "claim");
  const assignments = new Map<string, Invoice[]>();
  const unmatched: UnmatchedReimbursement[] = [];

  for (const statement of statements) {
    if (statement.NeedsReview) { unmatched.push({ DocumentId: statement.Id, Reason: "needs-review" }); continue; }
    if (!statement.Insurer) { unmatched.push({ DocumentId: statement.Id, Reason: "missing-insurer" }); continue; }
    const ranked = expenses.map(expense => ({ expense, score: matchScore(expense, statement) })).sort((a, b) => b.score - a.score);
    const best = ranked[0];
    const runnerUp = ranked[1];
    if (!best || best.score < 8) { unmatched.push({ DocumentId: statement.Id, Reason: "no-expense-match" }); continue; }
    if (runnerUp && runnerUp.score >= best.score - 1) { unmatched.push({ DocumentId: statement.Id, Reason: "ambiguous-match" }); continue; }
    assignments.set(best.expense.Id, [...(assignments.get(best.expense.Id) ?? []), statement]);
  }

  const cases = expenses.map(expense => {
    const matched = assignments.get(expense.Id) ?? [];
    const original = expense.BilledAmount ?? expense.DetectedAmount;
    const member = expense.Member || "unknown";
    const order = insurerOrder(member);
    const primaryAmount = matched.filter(item => item.Insurer === order[0]).reduce((sum, item) => sum + (item.ReimbursedAmount ?? item.DetectedAmount ?? 0), 0);
    const secondaryAmount = matched.filter(item => item.Insurer === order[1]).reduce((sum, item) => sum + (item.ReimbursedAmount ?? item.DetectedAmount ?? 0), 0);
    const reimbursed = primaryAmount + secondaryAmount;
    const remaining = original == null ? null : Math.max(0, Math.round((original - reimbursed) * 100) / 100);
    const seen = new Set(matched.map(item => item.Insurer).filter(Boolean));
    let action: ReconciliationCase["Action"] = "complete";
    let status: ReconciliationCase["Status"] = "fully-reimbursed";
    let next: ReconciliationCase["NextInsurer"] = null;
    let summary = "Documents rapprochés; aucun solde potentiel détecté.";
    if (expense.NeedsReview || member === "unknown" || original == null) {
      action = "review-amount"; status = "needs-attention";
      summary = original == null ? "Montant de la facture à confirmer avant le rapprochement." : "Vérifiez la personne ou la classification avant le rapprochement.";
    }
    else if (!seen.has(order[0])) { action = "submit-primary"; status = "waiting-primary"; next = insurerName(order[0]); summary = `En attente d'un relevé de ${next}.`; }
    else if (remaining! > 0 && !seen.has(order[1])) { action = "submit-secondary"; status = "waiting-secondary"; next = insurerName(order[1]); summary = `${remaining!.toFixed(2)} $ reste à vérifier auprès de ${next}; ce montant n'est pas garanti.`; }
    else if (remaining! > 0) { action = "verify-balance"; status = "needs-attention"; summary = `${remaining!.toFixed(2)} $ reste à charge potentiel après les relevés trouvés.`; }
    return {
      Id: createHash("sha256").update(expense.Id + matched.map(item => item.Id).sort().join(":" )).digest("hex").slice(0, 24),
      Member: member, Provider: expense.Provider, ServiceDate: expense.ServiceDate,
      OriginalAmount: original, ReimbursedAmount: reimbursed,
      PrimaryInsurer: insurerName(order[0]), PrimaryReimbursedAmount: primaryAmount,
      SecondaryInsurer: insurerName(order[1]), SecondaryReimbursedAmount: secondaryAmount,
      PotentialRemaining: remaining,
      Currency: expense.Currency || "CAD", NextInsurer: next, Action: action, Summary: summary,
      Status: status,
      Confidence: matched.length ? Math.min(expense.Confidence, ...matched.map(item => item.Confidence)) : expense.Confidence,
      DocumentIds: [expense.Id, ...matched.map(item => item.Id)]
    };
  });
  return {
    cases: cases.sort((a, b) => Number(a.Action === "complete") - Number(b.Action === "complete") || (b.PotentialRemaining ?? 0) - (a.PotentialRemaining ?? 0)),
    unmatched
  };
}

export function buildReconciliations(items: Invoice[]): ReconciliationCase[] {
  return buildReconciliationSnapshot(items).cases;
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
