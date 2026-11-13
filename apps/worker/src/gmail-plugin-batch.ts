import { randomUUID } from "node:crypto";
import type { RawMail } from "./gmail-client.js";

/** In-memory evidence only. No network, credentials, storage, or production wiring. */
export type GmailCall = <T>(token: string, path: string) => Promise<T>;
export type PluginBatch = {
  schema: 1;
  account: string;
  messages: RawMail[];
  attachments: Array<{ messageId: string; attachmentId: string; size: number; data: string }>;
  queries: Array<{ q: string; maxResults: number; complete: true;
    pages: Array<{ pageToken?: string; messageIds: string[]; nextPageToken?: string }> }>;
};
const fail = (): never => { throw new Error("Incomplete or invalid Gmail plugin evidence; collection coverage is not established."); };
function check(value: unknown): asserts value { if (!value) fail(); }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(v);
const attachmentId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,1500}$/.test(v);
const size = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= 20_000_000;
const pageToken = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 4096;
const account = (v: unknown): v is string => typeof v === "string" && v.length <= 320 && /^[^\s@]+@[^\s@]+$/.test(v) && v === v.toLowerCase();
function bytes(data: unknown, length: unknown): string {
  check(typeof data === "string" && size(length) && data.length <= 26_666_670 && /^[A-Za-z0-9_-]*={0,2}$/.test(data));
  const decoded = Buffer.from(data, "base64url");
  check(decoded.length === length && decoded.toString("base64url") === data.replace(/=+$/, ""));
  return data;
}
function boundedClone(value: unknown): unknown {
  let serialized: string;
  try { serialized = JSON.stringify(value); } catch { return fail(); }
  check(typeof serialized === "string" && Buffer.byteLength(serialized) <= 64_000_000);
  return JSON.parse(serialized);
}
function validateHeaders(value: unknown): asserts value is Array<{ name: string; value: string }> {
  check(Array.isArray(value) && value.length <= 200);
  for (const header of value) check(object(header) && typeof header.name === "string" && header.name.length > 0 && header.name.length <= 200
    && typeof header.value === "string" && header.value.length <= 64_000);
}

/** Convert the observed Gmail plugin full-message shape; never substitute snippet/summary text. */
export function pluginMessageToRawMail(input: unknown): RawMail {
  const message = boundedClone(input);
  check(object(message) && id(message.id) && id(message.thread_id) && typeof message.internal_date === "string"
    && Array.isArray(message.label_ids) && object(message.payload));
  let count = 0;
  const convert = (part: unknown, depth: number): NonNullable<RawMail["payload"]> => {
    check(object(part) && ++count <= 200 && depth <= 12 && typeof part.mime_type === "string"
      && typeof part.filename === "string" && object(part.body));
    validateHeaders(part.headers);
    const body = part.body;
    check(size(body.size));
    const hasEncoded = body.base64_url_content !== null && body.base64_url_content !== undefined;
    const hasContent = body.content !== null && body.content !== undefined;
    const hasAttachment = body.attachment_id !== null && body.attachment_id !== undefined;
    let data: string | undefined;
    if (hasEncoded) data = bytes(body.base64_url_content, body.size);
    if (hasContent) {
      check(typeof body.content === "string" && Buffer.byteLength(body.content, "utf8") === body.size);
      const encoded = Buffer.from(body.content, "utf8").toString("base64url");
      // Reject conflicting decoded and original bytes rather than choosing a convenient body.
      check(data === undefined || data.replace(/=+$/, "") === encoded);
      data ??= encoded;
    }
    if (hasAttachment) check(attachmentId(body.attachment_id) && data === undefined);
    const children = part.parts == null ? [] : part.parts;
    check(Array.isArray(children));
    check(data !== undefined || hasAttachment || body.size === 0);
    return { mimeType: part.mime_type, filename: part.filename, headers: part.headers,
      body: { size: body.size, ...(data !== undefined ? { data } : {}), ...(hasAttachment ? { attachmentId: body.attachment_id as string } : {}) },
      parts: children.map(child => convert(child, depth + 1)) };
  };
  const raw = { id: message.id, threadId: message.thread_id, internalDate: message.internal_date,
    labelIds: message.label_ids as string[], payload: convert(message.payload, 0) };
  validateMail(raw, new Map(), false);
  return raw;
}

type AttachmentData = { size: number; data: string };
const attachmentKey = (messageId: string, attachmentId: string) => JSON.stringify([messageId, attachmentId]);
function validateMail(value: unknown, attachments: Map<string, AttachmentData>, requireAttachments = true): asserts value is RawMail {
  check(object(value) && id(value.id) && id(value.threadId) && typeof value.internalDate === "string"
    && /^\d{1,16}$/.test(value.internalDate) && Number.isSafeInteger(Number(value.internalDate))
    && Number.isFinite(new Date(Number(value.internalDate)).getTime())
    && Array.isArray(value.labelIds) && value.labelIds.length <= 100 && value.labelIds.every(id) && object(value.payload));
  validateHeaders(value.payload.headers);
  check(value.payload.headers.filter(header => header.name.toLowerCase() === "message-id").length <= 1);
  for (const name of ["from", "subject"]) {
    check(value.payload.headers.filter(header => header.name.toLowerCase() === name).length === 1);
  }
  let count = 0;
  const walk = (part: unknown, depth: number) => {
    check(object(part) && ++count <= 200 && depth <= 12 && typeof part.mimeType === "string" && part.mimeType.length <= 200);
    if (part.headers !== undefined) validateHeaders(part.headers);
    if (part.filename !== undefined) check(typeof part.filename === "string" && part.filename.length <= 255);
    check(object(part.body) && size(part.body.size));
    const body = part.body;
    if (body.data !== undefined) bytes(body.data, body.size);
    if (body.attachmentId !== undefined) {
      check(attachmentId(body.attachmentId) && body.data === undefined);
      // External text bodies are not consumed by current parsers: do not silently omit them.
      check(typeof part.filename === "string" && part.filename.length > 0);
      if (requireAttachments) {
        const attachment = attachments.get(attachmentKey(value.id as string, body.attachmentId));
        check(attachment && attachment.size === body.size);
      }
    }
    // Inline named files are currently ignored by normalizeMail; refuse rather than lose a file.
    if (part.filename) check(body.attachmentId !== undefined);
    const children = part.parts === undefined ? [] : part.parts;
    check(Array.isArray(children));
    check(body.data !== undefined || body.attachmentId !== undefined || body.size === 0);
    if (part.mimeType.startsWith("multipart/")) check(children.length > 0);
    if (!children.length && !part.filename && part.mimeType.startsWith("text/")) check(body.data !== undefined);
    for (const child of children) walk(child, depth + 1);
  };
  walk(value.payload, 0);
  // normalizeMail caps attachment metadata at 30; never validate a batch it would truncate.
  check(countAttachments(value.payload) <= 30);
}
function countAttachments(part: NonNullable<RawMail["payload"]>): number {
  return (part.filename && part.body?.attachmentId ? 1 : 0) + (part.parts || []).reduce((n, child) => n + countAttachments(child), 0);
}

/**
 * Validates the WHOLE batch before exposing any page. `complete` is an upstream
 * assertion, not independent proof of source completeness. No Gmail query evaluation.
 */
export function createPluginBatchTransport(input: unknown, expectedAccount: string): { account: string; token: string; gmail: GmailCall } {
  const batch = boundedClone(input);
  check(account(expectedAccount) && object(batch) && batch.schema === 1 && batch.account === expectedAccount
    && Array.isArray(batch.messages) && batch.messages.length <= 500
    && Array.isArray(batch.attachments) && batch.attachments.length <= 1000
    && Array.isArray(batch.queries) && batch.queries.length <= 20);
  const attachments = new Map<string, AttachmentData>();
  for (const attachment of batch.attachments) {
    check(object(attachment) && id(attachment.messageId) && attachmentId(attachment.attachmentId));
    const key = attachmentKey(attachment.messageId, attachment.attachmentId);
    check(!attachments.has(key));
    attachments.set(key, { size: attachment.size as number, data: bytes(attachment.data, attachment.size) });
  }
  const messages = new Map<string, RawMail>();
  for (const message of batch.messages) {
    validateMail(message, attachments);
    check(!messages.has(message.id));
    messages.set(message.id, message);
  }
  for (const key of attachments.keys()) {
    const [messageId, attachmentId] = JSON.parse(key) as [string, string];
    const message = messages.get(messageId);
    const contains = (part: NonNullable<RawMail["payload"]>): boolean => part.body?.attachmentId === attachmentId || !!part.parts?.some(contains);
    check(message?.payload && contains(message.payload));
  }
  const queries = new Map<string, PluginBatch["queries"][number]>();
  for (const query of batch.queries) {
    check(object(query) && typeof query.q === "string" && query.q.length > 0 && query.q.length <= 8000
      && Number.isInteger(query.maxResults) && Number(query.maxResults) >= 1 && Number(query.maxResults) <= 50
      && query.complete === true && Array.isArray(query.pages) && query.pages.length > 0 && query.pages.length <= 100);
    const key = JSON.stringify([query.q, query.maxResults]);
    check(!queries.has(key));
    const seenTokens = new Set<string>(), seenIds = new Set<string>();
    let expectedToken: string | undefined;
    for (let i = 0; i < query.pages.length; i++) {
      const page = query.pages[i];
      check(object(page) && page.pageToken === expectedToken && Array.isArray(page.messageIds) && page.messageIds.length <= Number(query.maxResults));
      if (page.pageToken !== undefined) { check(pageToken(page.pageToken) && !seenTokens.has(page.pageToken)); seenTokens.add(page.pageToken); }
      for (const messageId of page.messageIds) { check(id(messageId) && messages.has(messageId) && !seenIds.has(messageId)); seenIds.add(messageId); }
      if (i < query.pages.length - 1) check(pageToken(page.nextPageToken));
      else check(page.nextPageToken === undefined);
      expectedToken = page.nextPageToken as string | undefined;
    }
    queries.set(key, query as unknown as PluginBatch["queries"][number]);
  }
  const token = randomUUID(); // opaque batch handle, NOT an OAuth token
  const gmail: GmailCall = async <T>(providedToken: string, path: string): Promise<T> => {
    check(providedToken === token && typeof path === "string" && path.length <= 16_000);
    const list = /^messages\?([^#]+)$/.exec(path);
    if (list) {
      const params = new URLSearchParams(list[1]);
      check([...params.keys()].every(key => ["q", "maxResults", "pageToken"].includes(key))
        && [...new Set(params.keys())].every(key => params.getAll(key).length === 1));
      check(/^(?:[1-9]|[1-4]\d|50)$/.test(params.get("maxResults") || ""));
      const query = queries.get(JSON.stringify([params.get("q"), Number(params.get("maxResults"))]));
      const page = query?.pages.find(page => page.pageToken === (params.has("pageToken") ? params.get("pageToken") : undefined));
      check(page);
      return structuredClone({ messages: page.messageIds.map(id => ({ id })), ...(page.nextPageToken ? { nextPageToken: page.nextPageToken } : {}) }) as T;
    }
    const message = /^messages\/([A-Za-z0-9_-]{1,200})\?format=full$/.exec(path);
    if (message) { const raw = messages.get(message[1]); check(raw); return structuredClone(raw) as T; }
    const attachment = /^messages\/([A-Za-z0-9_-]{1,200})\/attachments\/([A-Za-z0-9_-]{1,1500})$/.exec(path);
    if (attachment) { const data = attachments.get(attachmentKey(attachment[1], attachment[2])); check(data); return structuredClone(data) as T; }
    return fail();
  };
  return { account: expectedAccount, token, gmail };
}
