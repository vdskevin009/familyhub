import { createHash } from "node:crypto";

export const kinds = ["receipt", "invoice", "claim", "bill", "administrative", "marketing", "ignore", "other"] as const;
export type Kind = typeof kinds[number];
export type Classification = {
  kind: Kind; confidence: number; transaction: boolean;
  reimbursement: "possible" | "unknown" | "no"; reason: string;
  amount: number | null; currency: string; category: "health" | "travel" | "other";
  member: "Kevin" | "Jasmine" | "Nathan" | "unknown";
  documentRole: "expense" | "insurer-statement" | "other";
  insurer: "desjardins" | "blue-cross" | null;
  serviceDate: string | null;
  billedAmount: number | null;
  reimbursedAmount: number | null;
  attention?: "critical" | "action" | "important" | "none";
  attentionReason?: string;
};
export type Attachment = {
  Id: string; FileName: string; MimeType: string; Size: number;
  AnalysisStatus?: "text-extracted" | "unsupported" | "too-large" | "failed";
  ExtractedCharacters?: number;
};
export type Mail = {
  id: string; threadId: string; internetMessageId: string; subject: string; sender: string;
  receivedAt: string; text: string; labels: string[]; unsubscribe: boolean; bulk: boolean;
  attachments: Attachment[]; attachmentText?: string;
  blueCrossExport?: import("./bluecross.js").BlueCrossExport;
};
export type Invoice = {
  AnalysisVersion: number;
  Id: string; AccountLabel: string; AccountEmail: string; SourceMessageId: string;
  ThreadId: string; InternetMessageId: string; Subject: string; Sender: string; Provider: string;
  ReceivedAt: string; Category: number; Status: number; DetectedAmount: number | null;
  Currency: string; Confidence: number; Notes: string; Attachments: Attachment[];
  DocumentType: Kind; Reasons: string[]; WorkerManaged: true; NeedsReview: boolean;
  ReimbursementEligibility: Classification["reimbursement"]; ClassificationSource: "rules" | "codex" | "manual" | "unavailable";
  Member: Classification["member"]; DocumentRole: Classification["documentRole"]; Insurer: Classification["insurer"];
  ServiceDate: string | null; BilledAmount: number | null; ReimbursedAmount: number | null;
  AmountSource: "ai" | "email-text" | "missing"; HasUnsubscribe: boolean;
  AttentionLevel: "critical" | "action" | "important" | "none"; AttentionReason: string;
  CorrectedAt?: string; UpdatedAt: string; Fingerprint: string; LastDecisionId?: string;
  ImportWarning?: string; ClaimedService?: string; StatementDate?: string; StructuredSource?: "blue-cross-portal";
};
export type Correction = { account: string; fingerprint: string; kind: Kind; at: string; confirmations?: number; sender?: string; subject?: string };

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
  required: ["kind", "confidence", "transaction", "reimbursement", "reason", "amount", "currency", "category", "member", "documentRole", "insurer", "serviceDate", "billedAmount", "reimbursedAmount", "attention", "attentionReason"],
  properties: {
    kind: { type: "string", enum: kinds }, confidence: { type: "number", minimum: 0, maximum: 1 },
    transaction: { type: "boolean" }, reimbursement: { type: "string", enum: ["possible", "unknown", "no"] },
    reason: { type: "string" }, amount: { type: ["number", "null"] }, currency: { type: "string" },
    category: { type: "string", enum: ["health", "travel", "other"] },
    member: { type: "string", enum: ["Kevin", "Jasmine", "Nathan", "unknown"] },
    documentRole: { type: "string", enum: ["expense", "insurer-statement", "other"] },
    insurer: { type: ["string", "null"], enum: ["desjardins", "blue-cross", null] },
    serviceDate: { type: ["string", "null"] },
    billedAmount: { type: ["number", "null"] },
    reimbursedAmount: { type: ["number", "null"] },
    attention: { type: "string", enum: ["critical", "action", "important", "none"] },
    attentionReason: { type: "string" }
  }
};

export function validateClassification(input: unknown): Classification {
  const x = input as Classification;
  if (!x || !kinds.includes(x.kind) || !Number.isFinite(x.confidence) || x.confidence < 0 || x.confidence > 1
    || typeof x.transaction !== "boolean" || !["possible", "unknown", "no"].includes(x.reimbursement)
    || typeof x.reason !== "string" || !["health", "travel", "other"].includes(x.category)
    || !["Kevin", "Jasmine", "Nathan", "unknown"].includes(x.member)
    || !["expense", "insurer-statement", "other"].includes(x.documentRole)
    || !(x.insurer === null || x.insurer === "desjardins" || x.insurer === "blue-cross")
    || !(x.serviceDate === null || /^\d{4}-\d{2}-\d{2}$/.test(x.serviceDate))
    || !(x.amount === null || (Number.isFinite(x.amount) && x.amount > 0 && x.amount < 1e9))
    || !(x.billedAmount === null || (Number.isFinite(x.billedAmount) && x.billedAmount > 0 && x.billedAmount < 1e9))
    || !(x.reimbursedAmount === null || (Number.isFinite(x.reimbursedAmount) && x.reimbursedAmount >= 0 && x.reimbursedAmount < 1e9))
    || !["critical", "action", "important", "none"].includes(x.attention || "none")
    || typeof (x.attentionReason ?? "") !== "string"
    || typeof x.currency !== "string" || !/^(?:[A-Z]{3})?$/.test(x.currency)) throw new Error("Invalid classification output.");
  return { ...x, attention: x.attention || "none", attentionReason: (x.attentionReason || "").slice(0, 600), reason: x.reason.slice(0, 600) };
}

function textAmount(mail: Mail): { amount: number; currency: string } | null {
  const value = `${mail.subject}\n${mail.text}\n${mail.attachmentText || ""}`;
  const match = value.match(/(?:total(?: paid)?|amount paid|montant(?: pay[eé])?|balance due|amount due)\s*[:\-]?\s*(?:(CAD|USD)\s*)?\$?\s*([0-9]{1,7}(?:[ ,.][0-9]{3})*(?:[.,][0-9]{2}))/i);
  if (!match) return null;
  const amount = Number(match[2].replace(/\s/g, "").replace(/,(?=\d{2}$)/, ".").replace(/,/g, ""));
  return Number.isFinite(amount) && amount > 0 ? { amount, currency: (match[1] || "CAD").toUpperCase() } : null;
}

export function toInvoice(mail: Mail, email: string, label: string, result: Classification, source: Invoice["ClassificationSource"]): Invoice {
  const excluded = (result.kind === "marketing" || result.kind === "ignore") && result.confidence >= .9;
  const acceptedAdministrative = result.kind === "administrative" && result.confidence >= .9 && source !== "unavailable";
  // A score is not coverage verification. Nothing is marked ready to claim by the classifier.
  // High-confidence administrative notices are useful documents even when they are not transactions.
  const needsReview = !excluded && !acceptedAdministrative && (result.confidence < .9 || source === "unavailable" || !result.transaction || !evidence(mail).transaction);
  const fallback = result.amount == null ? textAmount(mail) : null;
  const amount = result.amount ?? fallback?.amount ?? null;
  const member = result.member === "unknown" && /jasmine/i.test(label) ? "Jasmine" : result.member === "unknown" && /kevin/i.test(label) ? "Kevin" : result.member;
  return {
    AnalysisVersion: 3,
    Id: recordId(email, mail.id), AccountLabel: label, AccountEmail: email,
    SourceMessageId: mail.id, ThreadId: mail.threadId, InternetMessageId: mail.internetMessageId,
    Subject: mail.subject, Sender: mail.sender, Provider: mail.sender.split("<")[0].replace(/"/g, "").trim(),
    ReceivedAt: mail.receivedAt, Category: result.category === "health" ? 0 : result.category === "travel" ? 1 : 2,
    Status: excluded ? 4 : 0, DetectedAmount: amount, Currency: result.currency || fallback?.currency || "",
    Confidence: Math.round(result.confidence * 100), Notes: "", Attachments: mail.attachments,
    DocumentType: result.kind, Reasons: [result.reason], WorkerManaged: true, NeedsReview: needsReview,
    ReimbursementEligibility: result.transaction ? result.reimbursement : "unknown", ClassificationSource: source,
    Member: member, DocumentRole: result.documentRole, Insurer: result.insurer, ServiceDate: result.serviceDate,
    BilledAmount: result.billedAmount ?? (result.documentRole === "expense" ? amount : null),
    ReimbursedAmount: result.reimbursedAmount ?? (result.documentRole === "insurer-statement" ? amount : null),
    AmountSource: result.amount != null || result.billedAmount != null || result.reimbursedAmount != null ? "ai" : fallback ? "email-text" : "missing",
    HasUnsubscribe: mail.unsubscribe,
    AttentionLevel: result.attention || "none", AttentionReason: result.attentionReason || "",
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
