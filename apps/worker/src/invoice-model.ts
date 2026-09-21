import { createHash } from "node:crypto";

export const kinds = ["receipt", "invoice", "claim", "bill", "administrative", "marketing", "ignore", "other"] as const;
export type Kind = typeof kinds[number];
export type Classification = {
  kind: Kind; confidence: number; transaction: boolean;
  reimbursement: "possible" | "unknown" | "no"; reason: string;
  amount: number | null; currency: string; category: "health" | "travel" | "other";
};
export type Attachment = { Id: string; FileName: string; MimeType: string; Size: number };
export type Mail = {
  id: string; threadId: string; internetMessageId: string; subject: string; sender: string;
  receivedAt: string; text: string; labels: string[]; unsubscribe: boolean; bulk: boolean;
  attachments: Attachment[];
};
export type Invoice = {
  Id: string; AccountLabel: string; AccountEmail: string; SourceMessageId: string;
  ThreadId: string; InternetMessageId: string; Subject: string; Sender: string; Provider: string;
  ReceivedAt: string; Category: number; Status: number; DetectedAmount: number | null;
  Currency: string; Confidence: number; Notes: string; Attachments: Attachment[];
  DocumentType: Kind; Reasons: string[]; WorkerManaged: true; NeedsReview: boolean;
  ReimbursementEligibility: Classification["reimbursement"]; ClassificationSource: "rules" | "codex" | "manual" | "unavailable";
  CorrectedAt?: string; UpdatedAt: string; Fingerprint: string;
};
export type Correction = { account: string; fingerprint: string; kind: Kind; at: string };

export function recordId(email: string, messageId: string): string {
  return createHash("sha256").update(`${email.toLowerCase()}:${messageId}`).digest("hex");
}
// Exact sender AND subject template: a promotional correction must never blacklist a merchant's receipts.
export function fingerprint(mail: Pick<Mail, "sender" | "subject">): string {
  const sender = (mail.sender.match(/<([^>]+)>/)?.[1] || mail.sender).trim().toLowerCase();
  const subject = mail.subject.toLowerCase().replace(/\b\d{4,}\b/g, "#").replace(/\s+/g, " ").trim();
  return createHash("sha256").update(sender + "\n" + subject).digest("hex");
}

export function evidence(mail: Mail): { marketing: boolean; transaction: boolean } {
  const text = `${mail.subject}\n${mail.text}`;
  const transaction = /(?:invoice|receipt|facture|reçu|recu|order|booking|reservation)\s*(?:number|no\.?|#|n[°º])\s*[:#-]?\s*[a-z0-9-]{3,}/i.test(text)
    || /payment (?:received|successful|confirmation)|thank you for your (?:payment|purchase)|paiement (?:reçu|effectué)|total paid|amount paid|montant payé|balance due|amount due/i.test(text)
    || mail.attachments.some(a => /(?:invoice|receipt|facture|reçu|recu|eob)[-_ .0-9]/i.test(a.FileName));
  const hits = (text.match(/shop now|book now|save up to|limited time|promo code|special offer|newsletter|% off|réservez|offre spéciale|promotion|soldes|se désabonner/gi) || []).length;
  return { transaction, marketing: !transaction && (mail.labels.includes("CATEGORY_PROMOTIONS") || hits >= 2 || (hits >= 1 && (mail.unsubscribe || mail.bulk))) };
}

export const classificationSchema = {
  type: "object", additionalProperties: false,
  required: ["kind", "confidence", "transaction", "reimbursement", "reason", "amount", "currency", "category"],
  properties: {
    kind: { type: "string", enum: kinds }, confidence: { type: "number", minimum: 0, maximum: 1 },
    transaction: { type: "boolean" }, reimbursement: { type: "string", enum: ["possible", "unknown", "no"] },
    reason: { type: "string" }, amount: { type: ["number", "null"] }, currency: { type: "string" },
    category: { type: "string", enum: ["health", "travel", "other"] }
  }
};

export function validateClassification(input: unknown): Classification {
  const x = input as Classification;
  if (!x || !kinds.includes(x.kind) || !Number.isFinite(x.confidence) || x.confidence < 0 || x.confidence > 1
    || typeof x.transaction !== "boolean" || !["possible", "unknown", "no"].includes(x.reimbursement)
    || typeof x.reason !== "string" || !["health", "travel", "other"].includes(x.category)
    || !(x.amount === null || (Number.isFinite(x.amount) && x.amount > 0 && x.amount < 1e9))
    || typeof x.currency !== "string" || !/^(?:[A-Z]{3})?$/.test(x.currency)) throw new Error("Invalid classification output.");
  return { ...x, reason: x.reason.slice(0, 600) };
}

export function toInvoice(mail: Mail, email: string, label: string, result: Classification, source: Invoice["ClassificationSource"]): Invoice {
  const excluded = (result.kind === "marketing" || result.kind === "ignore") && result.confidence >= .9;
  const acceptedAdministrative = result.kind === "administrative" && result.confidence >= .9 && source !== "unavailable";
  // A score is not coverage verification. Nothing is marked ready to claim by the classifier.
  // High-confidence administrative notices are useful documents even when they are not transactions.
  const needsReview = !excluded && !acceptedAdministrative && (result.confidence < .9 || source === "unavailable" || !result.transaction || !evidence(mail).transaction);
  return {
    Id: recordId(email, mail.id), AccountLabel: label, AccountEmail: email,
    SourceMessageId: mail.id, ThreadId: mail.threadId, InternetMessageId: mail.internetMessageId,
    Subject: mail.subject, Sender: mail.sender, Provider: mail.sender.split("<")[0].replace(/"/g, "").trim(),
    ReceivedAt: mail.receivedAt, Category: result.category === "health" ? 0 : result.category === "travel" ? 1 : 2,
    Status: excluded ? 4 : 0, DetectedAmount: result.amount, Currency: result.currency,
    Confidence: Math.round(result.confidence * 100), Notes: "", Attachments: mail.attachments,
    DocumentType: result.kind, Reasons: [result.reason], WorkerManaged: true, NeedsReview: needsReview,
    ReimbursementEligibility: result.transaction ? result.reimbursement : "unknown", ClassificationSource: source,
    UpdatedAt: new Date().toISOString(), Fingerprint: fingerprint(mail)
  };
}

export function applyCorrection(item: Invoice, kind: unknown): Invoice {
  if (!kinds.includes(kind as Kind)) throw new Error("Unknown document category.");
  const next = kind as Kind;
  return { ...item, DocumentType: next, Status: next === "marketing" || next === "ignore" ? 4 : item.Status === 4 ? 0 : item.Status,
    ReimbursementEligibility: next === "marketing" || next === "ignore" ? "no" : "unknown",
    NeedsReview: false, ClassificationSource: "manual", CorrectedAt: new Date().toISOString(), UpdatedAt: new Date().toISOString() };
}
