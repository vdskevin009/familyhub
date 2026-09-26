import { createHash } from "node:crypto";
import type { Correction, Invoice } from "./invoice-model.js";

export type ReconciliationCase = {
  Id: string;
  Member: Invoice["Member"];
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
  UnallocatedReimbursedAmount?: number;
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
  member === "Jasmine" ? ["blue-cross", "desjardins"] : member === "Kevin" ? ["desjardins", "blue-cross"] : [];
const insurerName = (value: "desjardins" | "blue-cross"): "Desjardins" | "Blue Cross" => value === "desjardins" ? "Desjardins" : "Blue Cross";
const day = (value: string | null | undefined): number => value ? Date.parse(value.slice(0, 10)) / 86_400_000 : Number.NaN;
const providerKey = (value: string): string => value.toLowerCase().replace(/desjardins|blue cross|croix bleue|insurance|assurance/g, "").replace(/[^a-z0-9]+/g, " ").trim();

export function serviceKey(value: string): string | null {
  const key = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const services: Array<[string, RegExp]> = [
    ["physio", /\bphysio\b|physiotherap/], ["massage", /massage|massotherap/], ["chiro", /chiropr/],
    ["scaling", /scaling|detartrage/], ["root-planing", /root planing|aplan[.\w ]*de racines/],
    ["recall-exam", /examen de rappel|examination and diagnosis.*previous patient/],
    ["polishing", /polishing|polissage/], ["bitewing", /bitewing|radio interproximale/],
    ["fluoride", /fluoride|fluorures/], ["social-worker", /social worker|travailleur social/],
    ["clinical-counsellor", /clinical counsellor|psychotherapist|conseiller clinique/],
    ["orthodontic", /orthodont/], ["escitalopram", /escitalopram/]
  ];
  return services.find(([, pattern]) => pattern.test(key))?.[0] ?? null;
}
const service = (item: Invoice) => serviceKey(item.ClaimedService || item.Provider);
const submitted = (item: Invoice): number | null => item.AccountLabel === "Local Desjardins import"
  ? Number(item.Notes.match(/Submitted (\d+\.\d{2})/)?.[1] ?? Number.NaN) : null;
const sameMoney = (left: number | null, right: number | null) => left != null && right != null && Math.abs(left - right) < .005;

/** Recover omitted report-derived expenses only when explicit service/amount evidence distinguishes them. */
export function recoverMissingDesjardinsExpenses(items: Invoice[], imported: Invoice[]): Invoice[] {
  const recovered: Invoice[] = [];
  for (const statement of items.filter(item => item.AccountLabel === "Local Desjardins import" && item.DocumentRole === "insurer-statement" && !item.NeedsReview && item.Status !== 4)) {
    if (items.some(item => item.DocumentRole === "expense" && item.Fingerprint === statement.Fingerprint)) continue;
    const candidates = imported.filter(item => item.StructuredSource && !item.NeedsReview && item.Member === statement.Member
      && item.ServiceDate === statement.ServiceDate && service(item) && service(item) === service(statement)
      && sameMoney(item.BilledAmount, submitted(statement)));
    if (candidates.length !== 1) continue;
    const related = items.filter(item => item.DocumentRole === "expense" && item.Member === statement.Member
      && item.ServiceDate === statement.ServiceDate && sameMoney(item.BilledAmount, candidates[0].BilledAmount));
    if (!related.length || related.some(item => !service(item) || service(item) === service(statement))) continue;
    recovered.push({ ...statement, Id: createHash("sha256").update(`recovered-expense:${statement.Id}`).digest("hex"),
      Provider: statement.Provider.replace(/^Desjardins\s*·\s*/, ""), DocumentType: "receipt", DocumentRole: "expense", Insurer: null,
      DetectedAmount: candidates[0].BilledAmount, BilledAmount: candidates[0].BilledAmount, ReimbursedAmount: null,
      Reasons: ["Separate service recovered from matching insurer reports; this is a reported expense, not proof of payment."],
      Notes: `${statement.Notes} Separate service restored; invoice/payment evidence still required.` });
  }
  return recovered;
}

function matchScore(expense: Invoice, statement: Invoice): number {
  if (expense.Member !== "unknown" && statement.Member !== "unknown" && expense.Member !== statement.Member) return -1;
  if (!statement.Insurer || statement.NeedsReview || expense.NeedsReview) return -1;
  const amount = expense.BilledAmount ?? expense.DetectedAmount;
  const paid = statement.ReimbursedAmount ?? statement.DetectedAmount;
  if (expense.Currency && statement.Currency && expense.Currency !== statement.Currency) return -1;
  const expenseService = service(expense); const statementService = service(statement);
  if (expenseService && statementService && expenseService !== statementService) return -1;
  if (statement.StructuredSource) {
    if (expense.Member === "unknown" || expense.Member !== statement.Member || expense.ServiceDate !== statement.ServiceDate
      || !expenseService || expenseService !== statementService || Math.min(expense.Confidence, statement.Confidence) < 90) return -1;
    const coordinated = expense.AccountLabel === "Local Desjardins import"
      && statement.BilledAmount != null && paid != null && sameMoney(amount, statement.BilledAmount - paid);
    return sameMoney(amount, statement.BilledAmount) || coordinated ? 20 : -1;
  }
  const claimed = submitted(statement);
  if (Number.isFinite(claimed) && !sameMoney(amount, claimed)) return -1;
  if (amount != null && paid != null && paid > amount * 1.05) return -1;

  // A person's name and a nearby date alone are not a confident match.
  const expenseProvider = providerKey(expense.Provider);
  const statementText = providerKey(`${statement.Subject} ${statement.Provider}`);
  const providerMatches = expenseProvider.length > 3 && statementText.includes(expenseProvider);
  const supportedService = expenseService != null && expenseService === statementService;
  if (expense.Member === "unknown" || expense.Member !== statement.Member || !expense.ServiceDate
    || expense.ServiceDate !== statement.ServiceDate || !(supportedService || providerMatches || sameMoney(amount, statement.BilledAmount))) return -1;

  let score = 0;
  if (expense.Member === statement.Member) score += 3;
  const expenseDay = day(expense.ServiceDate);
  const statementDay = day(statement.ServiceDate);
  if (Number.isFinite(expenseDay) && Number.isFinite(statementDay)) {
    const distance = Math.abs(expenseDay - statementDay);
    if (distance === 0) score += 5;
    else if (distance <= 3) score += 4;
    else if (distance <= 14) score += 2;
  }
  if (supportedService || providerMatches) score += 4;
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
    let original = expense.BilledAmount ?? expense.DetectedAmount;
    const coordinated = matched.filter(item => item.StructuredSource && item.BilledAmount != null
      && expense.AccountLabel === "Local Desjardins import"
      && sameMoney(original, item.BilledAmount - (item.ReimbursedAmount ?? 0)));
    if (coordinated.length === 1) original = coordinated[0].BilledAmount;
    const member = expense.Member || "unknown";
    const order = insurerOrder(member);
    const primaryAmount = matched.filter(item => item.Insurer === order[0]).reduce((sum, item) => sum + (item.ReimbursedAmount ?? item.DetectedAmount ?? 0), 0);
    const secondaryAmount = matched.filter(item => item.Insurer === order[1]).reduce((sum, item) => sum + (item.ReimbursedAmount ?? item.DetectedAmount ?? 0), 0);
    const reimbursed = Math.round(matched.reduce((sum, item) => sum + (item.ReimbursedAmount ?? item.DetectedAmount ?? 0), 0) * 100) / 100;
    const remaining = original == null ? null : Math.max(0, Math.round((original - reimbursed) * 100) / 100);
    const seen = new Set(matched.map(item => item.Insurer).filter(Boolean));
    let action: ReconciliationCase["Action"] = "complete";
    let status: ReconciliationCase["Status"] = "fully-reimbursed";
    let next: ReconciliationCase["NextInsurer"] = null;
    let summary = "Documents rapprochés; aucun solde potentiel détecté.";
    const pending = unmatched.some(result => {
      const statement = statements.find(item => item.Id === result.DocumentId)!;
      return statement.Member === member && statement.ServiceDate === expense.ServiceDate
        && (!service(statement) || !service(expense) || service(statement) === service(expense));
    });
    if (expense.NeedsReview || !order.length || original == null || pending || original != null && reimbursed > original + .005) {
      action = "review-amount"; status = "needs-attention";
      summary = original == null ? "Montant de la facture à confirmer avant le rapprochement."
        : !order.length ? `Ordre des assureurs à confirmer. Paiements trouvés : Desjardins ${matched.filter(item => item.Insurer === "desjardins").reduce((sum, item) => sum + (item.ReimbursedAmount ?? 0), 0).toFixed(2)} $; Blue Cross ${matched.filter(item => item.Insurer === "blue-cross").reduce((sum, item) => sum + (item.ReimbursedAmount ?? 0), 0).toFixed(2)} $.`
        : reimbursed > original + .005 ? "Les paiements dépassent le montant de la dépense; vérifiez les doublons ou ajustements."
        : pending ? "Un relevé associé reste non rapproché; vérifiez les doublons, ajustements ou la facture."
        : "Vérifiez la personne ou la classification avant le rapprochement.";
    }
    else if (!seen.has(order[0])) { action = "submit-primary"; status = "waiting-primary"; next = insurerName(order[0]); summary = `En attente d'un relevé de ${next}.`; }
    else if (remaining! > 0 && !seen.has(order[1])) { action = "submit-secondary"; status = "waiting-secondary"; next = insurerName(order[1]); summary = `${remaining!.toFixed(2)} $ reste à vérifier auprès de ${next}; ce montant n'est pas garanti.`; }
    else if (remaining! > 0) { action = "verify-balance"; status = "needs-attention"; summary = `${remaining!.toFixed(2)} $ reste à charge potentiel après les relevés trouvés.`; }
    return {
      Id: createHash("sha256").update(expense.Id + matched.map(item => item.Id).sort().join(":" )).digest("hex").slice(0, 24),
      Member: member, Provider: expense.Provider, ServiceDate: expense.ServiceDate,
      OriginalAmount: original, ReimbursedAmount: reimbursed,
      PrimaryInsurer: order[0] ? insurerName(order[0]) : null, PrimaryReimbursedAmount: primaryAmount,
      SecondaryInsurer: order[1] ? insurerName(order[1]) : null, SecondaryReimbursedAmount: secondaryAmount,
      UnallocatedReimbursedAmount: order.length ? 0 : reimbursed,
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
