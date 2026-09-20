import { ReimbursementCategory, ReimbursementItem, ReimbursementStatus, ScanStats } from "./types";
import { uid } from "./storage";

const DEFAULT_CLIENT_ID = "260396837927-9109b363fkc34udu7279mllrl0rb553o.apps.googleusercontent.com";
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

type GoogleAccount = {
  slot: string;
  email: string;
  name: string;
  token: string;
  expiresAt: number;
  scopes: Set<string>;
};

type CandidateAttachment = { id: string; fileName: string; mimeType: string; size: number };
type EmailCandidate = {
  messageId: string;
  threadId: string;
  internetMessageId: string;
  subject: string;
  sender: string;
  receivedAt: string;
  bodyText: string;
  attachments: CandidateAttachment[];
  labelIds: string[];
  listUnsubscribe: string;
  precedence: string;
};

type GoogleWindow = Window & {
  google?: {
    accounts?: {
      oauth2?: {
        initTokenClient(options: {
          client_id: string;
          scope: string;
          callback: (response: TokenResponse) => void;
          error_callback?: (error: { message?: string }) => void;
        }): { requestAccessToken(options?: { prompt?: string }): void };
      };
    };
  };
};

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

const accounts = new Map<string, GoogleAccount>();
const folderCache = new Map<string, string>();
let gisLoader: Promise<void> | undefined;

function ensureGoogleIdentity(): Promise<void> {
  const win = window as GoogleWindow;
  if (win.google?.accounts?.oauth2) return Promise.resolve();
  if (gisLoader) return gisLoader;
  gisLoader = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>("script[data-familyhub-google-identity]");
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Google sign-in could not be loaded.")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.dataset.familyhubGoogleIdentity = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Google sign-in could not be loaded."));
    document.head.appendChild(script);
  });
  return gisLoader;
}

function requireAccount(slot: string): GoogleAccount {
  const account = accounts.get(slot);
  if (!account) throw new Error(`Reconnect ${slot}'s Google account first.`);
  if (account.expiresAt <= Date.now() + 30_000) {
    accounts.delete(slot);
    throw new Error(`${slot}'s Google access expired. Reconnect and try again.`);
  }
  return account;
}

const sleep = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms));

async function apiJson<T>(url: string, token: string, init: RequestInit = {}, attempt = 0): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` }
  });
  if (response.ok) return await response.json() as T;

  let payload: { error?: { message?: string; status?: string; errors?: Array<{ reason?: string }> } } | undefined;
  try { payload = await response.json() as typeof payload; } catch { payload = undefined; }
  const detail = payload?.error?.message || `Google API request failed (${response.status}).`;
  const reason = payload?.error?.errors?.[0]?.reason || payload?.error?.status || "";
  const retryable = response.status === 429 || (response.status === 403 && ["rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded", "RESOURCE_EXHAUSTED"].includes(reason));
  if (retryable && attempt < 4) {
    await sleep((2 ** attempt) * 1000);
    return apiJson<T>(url, token, init, attempt + 1);
  }
  if (response.status === 401) throw new Error("Google access expired. Reconnect the account.");
  throw new Error(detail);
}

function decodeBase64Url(data: string): Uint8Array {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeText(data?: string): string {
  if (!data) return "";
  try { return new TextDecoder("utf-8").decode(decodeBase64Url(data)); }
  catch { return ""; }
}

function stripHtml(html: string): string {
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return doc.body?.textContent || "";
  } catch { return ""; }
}

type GmailPart = {
  mimeType?: string;
  filename?: string;
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailPart[];
  headers?: Array<{ name?: string; value?: string }>;
};

function collectPayload(part: GmailPart | undefined, plain: string[], html: string[], attachments: CandidateAttachment[]): void {
  if (!part) return;
  const mime = (part.mimeType || "").toLowerCase();
  if (part.filename && part.body?.attachmentId) {
    attachments.push({
      id: part.body.attachmentId,
      fileName: part.filename,
      mimeType: part.mimeType || "application/octet-stream",
      size: Number(part.body.size || 0)
    });
  }
  if (part.body?.data) {
    if (mime === "text/plain") plain.push(decodeText(part.body.data));
    else if (mime === "text/html") html.push(stripHtml(decodeText(part.body.data)));
  }
  for (const child of part.parts ?? []) collectPayload(child, plain, html, attachments);
}

function header(headers: Array<{ name?: string; value?: string }> | undefined, name: string): string {
  return (headers ?? []).find(item => item.name?.toLowerCase() === name.toLowerCase())?.value || "";
}

type GmailMessage = {
  id?: string;
  threadId?: string;
  internalDate?: string;
  labelIds?: string[];
  payload?: GmailPart;
};

function normalizeMessage(raw: GmailMessage): EmailCandidate {
  const plain: string[] = [];
  const html: string[] = [];
  const attachments: CandidateAttachment[] = [];
  collectPayload(raw.payload, plain, html, attachments);
  const headers = raw.payload?.headers ?? [];
  const body = (plain.join("\n") || html.join("\n")).replace(/\s+/g, " ").trim().slice(0, 30_000);
  const received = Number(raw.internalDate || 0);
  return {
    messageId: raw.id || "",
    threadId: raw.threadId || "",
    internetMessageId: header(headers, "Message-ID"),
    subject: header(headers, "Subject"),
    sender: header(headers, "From"),
    receivedAt: received > 0 ? new Date(received).toISOString() : new Date().toISOString(),
    bodyText: body,
    attachments,
    labelIds: raw.labelIds ?? [],
    listUnsubscribe: header(headers, "List-Unsubscribe"),
    precedence: header(headers, "Precedence")
  };
}

const healthKeywords = [
  "physio", "physiotherapy", "physical therapy", "massage therapy", " rmt ", "chiro", "chiropractor",
  "chiropractic", "osteo", "osteopath", "dental", "dentist", "orthodont", "pharmacy", "prescription",
  "optomet", "vision", "clinic", "medical", "therapy"
];
const travelKeywords = ["flight", "airline", "air canada", "westjet", "hotel", "airbnb", "booking.com", "expedia", "travel", "train", "rail", "car rental"];
const docKeywords = [
  "receipt", "invoice", "facture", "reçu", "recu", "tax invoice", "statement", "payment confirmation",
  "proof of payment", "amount due", "balance due", "payment received", "paid"
];
const strongClaimKeywords = ["reimbursement", "remboursement", "claim", "eligible expense", "health spending"];
const coverageKeywords = ["benefit", "benefits", "insurance", "assurance", "coverage"];
const adminKeywords = [
  "renewal notice", "policy renewal", "tax assessment", "notice of assessment", "contract",
  "warranty", "registration renewal", "statement available", "official notice"
];
const noiseKeywords = [
  "unsubscribe", "newsletter", "new arrivals", "shop now", "buy now", "limited time", "sale ends", "flash sale",
  "promo code", "exclusive offer", "save up to", "% off", "deal of the day", "recommended for you", "weekly deals",
  "special offer", "view in browser", "manage preferences", "free shipping", "clearance", "new collection",
  "last chance", "members only", "reward points", "earn points", "you may also like"
];

const labelledMoney = /(?:total(?:\s+paid)?|amount(?:\s+(?:paid|due))?|paid|montant(?:\s+pay[ée])?|total\s+pay[ée])\s*[:\-]?\s*(CAD|C\$|\$|EUR|€)?\s*(\d{1,7}(?:[\.,]\d{2})?)/i;
const currencyMoney = /(CAD|C\$|\$|EUR|€)\s*(\d{1,7}(?:[\.,]\d{2})?)/i;

function countHits(text: string, terms: string[]): number {
  return terms.reduce((sum, term) => sum + (text.includes(term) ? 1 : 0), 0);
}

function detectAmount(text: string): { amount: number | null; currency: string } {
  for (const regex of [labelledMoney, currencyMoney]) {
    const match = text.match(regex);
    if (!match) continue;
    const normalized = match[2].includes(",") && !match[2].includes(".") ? match[2].replace(",", ".") : match[2].replace(/,/g, "");
    const amount = Number(normalized);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const token = (match[1] || "").toUpperCase();
    return { amount, currency: token === "EUR" || token === "€" ? "EUR" : token ? "CAD" : "" };
  }
  return { amount: null, currency: "" };
}

function provider(sender: string): string {
  if (!sender.trim()) return "Unknown provider";
  const display = sender.split("<")[0].replace(/["']/g, "").trim();
  if (display && !display.includes("@")) return display.slice(0, 160);
  const match = sender.match(/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+/i);
  if (!match) return sender.slice(0, 160);
  return (match[0].split("@")[1]?.split(".")[0] || match[0]).slice(0, 160);
}

function analyze(message: EmailCandidate, accountLabel: string, accountEmail: string): { item: ReimbursementItem | null; reason: "noise" | "no-signal" | "kept" } {
  const attachmentText = message.attachments.map(item => item.fileName).join(" ");
  const text = ` ${message.subject} ${message.sender} ${message.bodyText} ${attachmentText} `.toLowerCase();
  const health = countHits(text, healthKeywords);
  const travel = countHits(text, travelKeywords);
  const documents = countHits(text, docKeywords);
  const strongClaims = countHits(text, strongClaimKeywords);
  const coverage = countHits(text, coverageKeywords);
  const admin = countHits(text, adminKeywords);
  const noise = countHits(text, noiseKeywords)
    + (message.listUnsubscribe ? 2 : 0)
    + (message.precedence.toLowerCase() === "bulk" ? 2 : 0)
    + (message.labelIds.includes("CATEGORY_PROMOTIONS") ? 5 : 0);

  const invoiceAttachment = message.attachments.some(item => /receipt|invoice|facture|recu|reçu|statement|bill/i.test(item.fileName));
  const administrativeAttachment = message.attachments.some(item =>
    /claim|benefit|policy|renewal|assessment|tax|contract|warranty|registration/i.test(item.fileName)
  );
  const pdfAttachment = message.attachments.some(item => /\.pdf$/i.test(item.fileName));
  const { amount, currency } = detectAmount(`${message.subject}\n${message.bodyText}`);

  const claimEvidence = strongClaims > 0 && (
    health > 0 || documents > 0 || amount !== null || invoiceAttachment || administrativeAttachment || pdfAttachment
  );
  const documentEvidence =
    invoiceAttachment ||
    (documents > 0 && amount !== null) ||
    (documents >= 2 && noise === 0) ||
    claimEvidence ||
    (admin > 0 && (pdfAttachment || administrativeAttachment));

  const marketingHeavy = noise >= 3 || message.labelIds.includes("CATEGORY_PROMOTIONS");
  if (marketingHeavy && !invoiceAttachment && !claimEvidence && !(documents >= 2 && amount !== null)) {
    return { item: null, reason: "noise" };
  }
  if (!documentEvidence) return { item: null, reason: noise > 0 ? "noise" : "no-signal" };

  const score = Math.min(14,
    Math.min(2, health) * 2 +
    Math.min(2, travel) +
    Math.min(3, documents) +
    Math.min(2, strongClaims) * 3 +
    Math.min(1, coverage) +
    Math.min(2, admin) * 2 +
    (invoiceAttachment ? 4 : 0) +
    (administrativeAttachment ? 2 : 0) +
    (pdfAttachment ? 1 : 0) +
    (amount !== null ? 2 : 0) -
    Math.min(6, noise)
  );

  if (score < 5) return { item: null, reason: noise > 0 ? "noise" : "no-signal" };

  const category = health > 0 && health >= travel
    ? ReimbursementCategory.HealthBenefit
    : travel > 0 ? ReimbursementCategory.Travel : ReimbursementCategory.Other;

  const documentType: ReimbursementItem["DocumentType"] =
    claimEvidence ? "claim" :
    text.includes("invoice") || text.includes("facture") ? "invoice" :
    text.includes("amount due") || text.includes("balance due") || text.includes("statement") ? "bill" :
    documents > 0 || invoiceAttachment ? "receipt" :
    admin > 0 ? "administrative" : "other";

  const reasons: string[] = [];
  if (invoiceAttachment) reasons.push("receipt/invoice attachment");
  if (administrativeAttachment) reasons.push("administrative attachment");
  if (amount !== null) reasons.push("amount detected");
  if (claimEvidence) reasons.push("claim/reimbursement evidence");
  if (health > 0) reasons.push("health expense signal");
  if (travel > 0) reasons.push("travel expense signal");
  if (admin > 0) reasons.push("administrative document signal");

  return {
    reason: "kept",
    item: {
      Id: uid(),
      AccountLabel: accountLabel.slice(0, 40),
      AccountEmail: accountEmail.slice(0, 254),
      SourceMessageId: message.messageId.slice(0, 500),
      ThreadId: message.threadId.slice(0, 500),
      InternetMessageId: message.internetMessageId.slice(0, 500),
      Subject: message.subject.slice(0, 500),
      Sender: message.sender.slice(0, 500),
      Provider: provider(message.sender),
      ReceivedAt: message.receivedAt,
      Category: category,
      Status: ReimbursementStatus.ToReview,
      DetectedAmount: amount,
      Currency: currency,
      Confidence: Math.max(45, Math.min(97, 42 + score * 4)),
      Notes: "",
      Attachments: message.attachments.slice(0, 30).map(item => ({
        Id: item.id.slice(0, 500),
        FileName: item.fileName.slice(0, 255),
        MimeType: item.mimeType.slice(0, 120),
        Size: Math.min(50_000_000, Math.max(0, item.size))
      })),
      DocumentType: documentType,
      Reasons: reasons
    }
  };
}
async function connect(slot: string, clientId = DEFAULT_CLIENT_ID): Promise<{ slot: string; email: string; name: string; canArchive: boolean }> {
  if (!clientId.endsWith(".apps.googleusercontent.com")) throw new Error("FamilyHub's Google OAuth client ID is invalid.");
  await ensureGoogleIdentity();
  const win = window as GoogleWindow;
  const oauth2 = win.google?.accounts?.oauth2;
  if (!oauth2) throw new Error("Google Identity Services did not load.");

  const response = await new Promise<TokenResponse>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: `openid email profile ${GMAIL_SCOPE} ${DRIVE_SCOPE}`,
      callback: result => result.error ? reject(new Error(result.error_description || result.error)) : resolve(result),
      error_callback: error => reject(new Error(error?.message || "Google sign-in was cancelled."))
    });
    client.requestAccessToken({ prompt: "select_account" });
  });

  if (!response.access_token) throw new Error("Google did not return an access token.");
  const scopes = new Set((response.scope || "").split(/\s+/).filter(Boolean));
  if (!scopes.has(GMAIL_SCOPE)) throw new Error("Gmail read-only permission was not granted.");

  const profile = await apiJson<{ email?: string; name?: string }>("https://www.googleapis.com/oauth2/v3/userinfo", response.access_token);
  const account: GoogleAccount = {
    slot,
    email: profile.email || "",
    name: profile.name || profile.email || "",
    token: response.access_token,
    expiresAt: Date.now() + Math.max(60, Number(response.expires_in || 3600)) * 1000,
    scopes
  };
  if (!account.email) throw new Error("Google did not return an email address.");
  accounts.set(slot, account);
  return { slot, email: account.email, name: account.name, canArchive: scopes.has(DRIVE_SCOPE) };
}

async function scan(slot: string, months: number): Promise<{ email: string; items: ReimbursementItem[]; stats: ScanStats }> {
  const account = requireAccount(slot);
  const lookback = Math.min(24, Math.max(1, Number(months || 12)));
  const terms = '{receipt invoice facture reçu recu reimbursement remboursement claim physio physiotherapy chiropractor dental pharmacy prescription massage statement "payment confirmation" "proof of payment" "amount due" "balance due" "policy renewal" "renewal notice" "tax assessment" warranty "registration renewal" "booking confirmation" "reservation confirmation"}';
  const q = `newer_than:${lookback}m ${terms} -category:promotions -category:social -category:forums`;
  const ids: string[] = [];
  let pageToken = "";

  for (let page = 0; page < 3 && ids.length < 250; page += 1) {
    const params = new URLSearchParams({ maxResults: "100", q });
    if (pageToken) params.set("pageToken", pageToken);
    const list = await apiJson<{ messages?: Array<{ id?: string }>; nextPageToken?: string }>(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`, account.token
    );
    ids.push(...(list.messages ?? []).flatMap(item => item.id ? [item.id] : []));
    pageToken = list.nextPageToken || "";
    if (!pageToken) break;
  }

  const items: ReimbursementItem[] = [];
  const stats: ScanStats = { scanned: 0, kept: 0, filteredNoise: 0, noDocumentSignal: 0 };
  for (let index = 0; index < ids.length; index += 4) {
    const batch = ids.slice(index, index + 4);
    const messages = await Promise.all(batch.map(id =>
      apiJson<GmailMessage>(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`, account.token)
        .then(normalizeMessage)
    ));
    for (const message of messages) {
      stats.scanned += 1;
      const result = analyze(message, slot, account.email);
      if (result.item) { items.push(result.item); stats.kept += 1; }
      else if (result.reason === "noise") stats.filteredNoise += 1;
      else stats.noDocumentSignal += 1;
    }
    if (index + 4 < ids.length) await sleep(150);
  }
  return { email: account.email, items, stats };
}

async function attachmentBytes(slot: string, messageId: string, attachmentId: string): Promise<Uint8Array> {
  const account = requireAccount(slot);
  const data = await apiJson<{ data?: string }>(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
    account.token
  );
  return decodeBase64Url(data.data || "");
}

async function downloadAttachment(slot: string, messageId: string, attachmentId: string, fileName: string, mimeType: string): Promise<void> {
  const bytes = await attachmentBytes(slot, messageId, attachmentId);
  const blob = new Blob([bytes], { type: mimeType || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName || "attachment";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function escapeDriveQuery(value: string): string {
  return value.replace(/'/g, "\\'");
}

async function ensureFolder(account: GoogleAccount, name: string, parentId?: string): Promise<string> {
  const cacheKey = `${account.email}:${parentId || "root"}:${name}`;
  const cached = folderCache.get(cacheKey);
  if (cached) return cached;

  const query = [
    `name='${escapeDriveQuery(name)}'`,
    "mimeType='application/vnd.google-apps.folder'",
    "trashed=false",
    parentId ? `'${escapeDriveQuery(parentId)}' in parents` : "'root' in parents"
  ].join(" and ");
  const params = new URLSearchParams({ q: query, spaces: "drive", fields: "files(id,name)", pageSize: "10" });
  const list = await apiJson<{ files?: Array<{ id: string }> }>(`https://www.googleapis.com/drive/v3/files?${params}`, account.token);
  const existing = list.files?.[0]?.id;
  if (existing) { folderCache.set(cacheKey, existing); return existing; }

  const created = await apiJson<{ id: string }>("https://www.googleapis.com/drive/v3/files?fields=id", account.token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: parentId ? [parentId] : undefined,
      appProperties: { familyhub: "folder" }
    })
  });
  folderCache.set(cacheKey, created.id);
  return created.id;
}

function archiveSegments(item: ReimbursementItem, rootName: string): string[] {
  const year = new Date(item.ReceivedAt).getFullYear().toString();
  if (item.Category === ReimbursementCategory.HealthBenefit) return [rootName, "Administrative", "Health", "Claims", year];
  if (item.Category === ReimbursementCategory.Travel) return [rootName, "Administrative", "Travel", year];
  if (item.DocumentType === "bill" || item.DocumentType === "invoice") return [rootName, "Administrative", "Finance", "Bills", year];
  if (item.DocumentType === "receipt") return [rootName, "Administrative", "Purchases", year];
  return [rootName, "Administrative", "Other", year];
}

async function uploadFile(account: GoogleAccount, bytes: Uint8Array, fileName: string, mimeType: string, parentId: string, item: ReimbursementItem): Promise<string> {
  const boundary = `familyhub_${crypto.randomUUID()}`;
  const metadata = {
    name: fileName,
    parents: [parentId],
    appProperties: {
      familyhub: "document",
      sourceMessageId: item.SourceMessageId.slice(0, 100),
      accountLabel: item.AccountLabel.slice(0, 40),
      documentType: item.DocumentType || "other"
    }
  };
  const prefix = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mimeType || "application/octet-stream"}\r\n\r\n`;
  const suffix = `\r\n--${boundary}--`;
  const body = new Blob([prefix, bytes, suffix]);
  const response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${account.token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`
    },
    body
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(payload.error?.message || `Drive upload failed (${response.status}).`);
  }
  const result = await response.json() as { id: string };
  return result.id;
}

async function archiveFirstAttachment(item: ReimbursementItem, rootName = "FamilyHub"): Promise<{ fileId: string; path: string }> {
  const account = requireAccount(item.AccountLabel);
  if (!account.scopes.has(DRIVE_SCOPE)) throw new Error("Google Drive permission was not granted. Reconnect the account and approve Drive access.");
  const attachment = item.Attachments[0];
  if (!attachment) throw new Error("This email has no attachment to archive.");

  const segments = archiveSegments(item, rootName.trim() || "FamilyHub");
  let parentId: string | undefined;
  for (const segment of segments) parentId = await ensureFolder(account, segment, parentId);
  if (!parentId) throw new Error("Could not create the Drive archive folder.");

  const bytes = await attachmentBytes(item.AccountLabel, item.SourceMessageId, attachment.Id);
  const fileId = await uploadFile(account, bytes, attachment.FileName || "document", attachment.MimeType, parentId, item);
  return { fileId, path: segments.join("/") + "/" + attachment.FileName };
}

function openMessage(accountEmail: string, internetMessageId: string, gmailMessageId: string): void {
  const search = internetMessageId ? `rfc822msgid:${internetMessageId}` : gmailMessageId;
  const url = `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(accountEmail)}#search/${encodeURIComponent(search)}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

function disconnect(slot: string): void {
  accounts.delete(slot);
}

function connection(slot: string): { email: string; canArchive: boolean } | null {
  const account = accounts.get(slot);
  if (!account || account.expiresAt <= Date.now()) return null;
  return { email: account.email, canArchive: account.scopes.has(DRIVE_SCOPE) };
}

export const googleBridge = {
  connect,
  disconnect,
  connection,
  scan,
  downloadAttachment,
  archiveFirstAttachment,
  openMessage,
  defaultClientId: DEFAULT_CLIENT_ID
};
