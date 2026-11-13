import test from "node:test";
import assert from "node:assert/strict";
import { createPluginBatchTransport, pluginMessageToRawMail } from "../apps/worker/dist/gmail-plugin-batch.js";
import { normalizeMail, withAttachmentText } from "../apps/worker/dist/gmail-client.js";
import { parsePcExpressMail } from "../apps/worker/dist/pc-express-mail.js";
const account = "synthetic@example.test";
const q = 'after:1793491200 before:1793577600 {invoice receipt} -in:trash';
const html = '<html><body>Original évidence, not a snippet.</body></html>';
const body = content => ({ size: Buffer.byteLength(content), base64_url_content: null, content, attachment_id: null });
const plugin = (id = "abcdef123456", content = html) => ({ id, thread_id: "fedcba654321", internal_date: "1793534400000", label_ids: ["INBOX"], snippet: "Truncated summary",
  payload: { mime_type: "text/html", filename: "", headers: [{ name: "From", value: "Billing <billing@example.test>" }, { name: "Subject", value: "Your receipt" }, { name: "Message-ID", value: "<original@example.test>" }], body: body(content), parts: null } });
const batch = () => ({ schema: 1, account, messages: [pluginMessageToRawMail(plugin())], attachments: [],
  queries: [{ q, maxResults: 50, complete: true, pages: [{ messageIds: ["abcdef123456"] }] }] });
const listPath = (query = q, pageToken) => `messages?${new URLSearchParams({ q: query, maxResults: "50", ...(pageToken ? { pageToken } : {}) })}`;
const rejectsBatch = mutate => { const value = batch(); mutate(value); assert.throws(() => createPluginBatchTransport(value, account), /Incomplete or invalid/); };

test("observed snake_case full-message conversion preserves exact MIME, IDs, labels and received time", () => {
  const raw = pluginMessageToRawMail(plugin());
  assert.equal(Buffer.from(raw.payload.body.data, "base64url").toString(), html);
  assert.equal(raw.payload.body.size, Buffer.byteLength(html));
  assert.equal(raw.id, plugin().id); assert.equal(raw.threadId, plugin().thread_id);
  assert.equal(raw.internalDate, plugin().internal_date); assert.deepEqual(raw.labelIds, ["INBOX"]);
  assert.equal(raw.snippet, undefined);
  assert.equal(normalizeMail(raw).internetMessageId, "<original@example.test>");
});

test("encoded content is authoritative only when size and any decoded content agree", () => {
  const input = plugin(); input.payload.body.base64_url_content = Buffer.from(html).toString("base64url");
  assert.deepEqual(pluginMessageToRawMail(input), pluginMessageToRawMail(plugin()));
  input.payload.body.content = null; assert.equal(pluginMessageToRawMail(input).payload.body.data, input.payload.body.base64_url_content);
  input.payload.body.content = "x".repeat(Buffer.byteLength(html));
  assert.throws(() => pluginMessageToRawMail(input));
});

for (const [name, mutate] of [
  ["truncated decoded body", value => value.payload.body.size++],
  ["missing body with snippet", value => value.payload.body.content = null],
  ["invalid base64", value => value.payload.body.base64_url_content = "!!!!"],
  ["missing date", value => delete value.internal_date],
  ["invalid date", value => value.internal_date = "not-a-date"],
  ["missing labels", value => delete value.label_ids],
  ["duplicate subject", value => value.payload.headers.push({ name: "subject", value: "conflict" })],
]) test(`plugin conversion rejects ${name}`, () => { const value = plugin(); mutate(value); assert.throws(() => pluginMessageToRawMail(value)); });

test("missing internet Message-ID is allowed but never invented", () => {
  const value = plugin(); value.payload.headers.pop();
  assert.equal(normalizeMail(pluginMessageToRawMail(value)).internetMessageId, "");
});

test("exact complete query page chains replay without changing identity or order", async () => {
  const value = batch(); value.messages.push(pluginMessageToRawMail(plugin("abcdef123457")));
  value.queries[0].pages = [{ messageIds: ["abcdef123456"], nextPageToken: "opaque+/page=2" }, { pageToken: "opaque+/page=2", messageIds: ["abcdef123457"] }];
  const transport = createPluginBatchTransport(value, account);
  assert.deepEqual(await transport.gmail(transport.token, listPath()), { messages: [{ id: "abcdef123456" }], nextPageToken: "opaque+/page=2" });
  assert.deepEqual(await transport.gmail(transport.token, listPath(q, "opaque+/page=2")), { messages: [{ id: "abcdef123457" }] });
  const mail = await transport.gmail(transport.token, "messages/abcdef123456?format=full");
  assert.deepEqual(mail, value.messages[0]);
  mail.payload.body.data = "changed"; value.messages[0].payload.body.data = "changed";
  assert.equal((await transport.gmail(transport.token, "messages/abcdef123456?format=full")).payload.body.data, Buffer.from(html).toString("base64url"));
});

test("explicitly enumerated empty query is distinct from missing query", async () => {
  const value = batch(); value.queries[0].pages[0].messageIds = [];
  const { token, gmail } = createPluginBatchTransport(value, account);
  assert.deepEqual(await gmail(token, listPath()), { messages: [] });
  await assert.rejects(gmail(token, listPath(q + " changed")));
});

for (const [name, mutate] of [
  ["wrong account", value => value.account = "other@example.test"],
  ["missing schema", value => delete value.schema],
  ["incomplete search", value => value.queries[0].complete = false],
  ["missing tail page", value => value.queries[0].pages[0].nextPageToken = "missing"],
  ["page not starting at first result", value => value.queries[0].pages[0].pageToken = "page2"],
  ["unlinked page", value => value.queries[0].pages.push({ pageToken: "page2", messageIds: [] })],
  ["duplicate query", value => value.queries.push(structuredClone(value.queries[0]))],
  ["missing queried message", value => value.messages = []],
  ["duplicate message identity", value => value.messages.push(value.messages[0])],
  ["duplicate query result", value => value.queries[0].pages[0].messageIds.push("abcdef123456")],
  ["empty page evidence", value => value.queries[0].pages = []],
  ["oversized page", value => value.queries[0].maxResults = 0],
  ["missing MIME", value => delete value.messages[0].payload],
  ["inexact body size", value => value.messages[0].payload.body.size++],
  ["too many messages", value => value.messages = Array(501).fill(value.messages[0])],
]) test(`whole-batch preflight rejects ${name}`, () => rejectsBatch(mutate));

test("token/account isolation and unsupported paths have no network fallback", async () => {
  const originalFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("must never fetch"); };
  try {
    const first = createPluginBatchTransport(batch(), account), second = createPluginBatchTransport(batch(), account);
    for (const [token, path] of [[second.token, listPath()], [first.token, "messages/absent?format=full"], [first.token, "messages/abcdef123456?format=raw"],
      [first.token, listPath() + "&q=conflict"], [first.token, listPath() + "&includeSpamTrash=true"], [first.token, "https://gmail.googleapis.com/messages"],
      [first.token, listPath(q, "unknown-page")], [first.token, "messages/abcdef123456/attachments/missing"]]) await assert.rejects(first.gmail(token, path));
    assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; }
});

function attachedBatch() {
  const value = batch(), original = value.messages[0].payload;
  const attachmentId = "ANGjdJ" + "a_-01234".repeat(60);
  const content = Buffer.from("Original synthetic attachment text é.");
  value.messages[0].payload = { mimeType: "multipart/mixed", headers: original.headers, body: { size: 0 }, parts: [original,
    { mimeType: "text/plain", filename: "source.txt", body: { size: content.length, attachmentId } }] };
  value.attachments.push({ messageId: value.messages[0].id, attachmentId, size: content.length, data: content.toString("base64url") });
  return value;
}

test("long original attachment IDs and bytes survive existing attachment extraction", async () => {
  const value = attachedBatch(), { gmail, token } = createPluginBatchTransport(value, account);
  const mail = normalizeMail(await gmail(token, "messages/abcdef123456?format=full"));
  const result = await withAttachmentText(mail, token, gmail);
  assert.equal(result.attachments[0].Id, value.attachments[0].attachmentId);
  assert.equal(result.attachments[0].AnalysisStatus, "text-extracted");
  assert.match(result.attachmentText, /Original synthetic attachment text é/);
  assert.deepEqual(await gmail(token, `messages/abcdef123456/attachments/${encodeURIComponent(value.attachments[0].attachmentId)}`),
    { data: value.attachments[0].data, size: value.attachments[0].size });
});

test("observed multipart plugin PDF shape keeps original attachment reference without preview substitution", () => {
  const input = plugin(), text = input.payload;
  const attachmentId = "ANGjdJ" + "a".repeat(400);
  input.payload = { mime_type: "multipart/mixed", filename: "", headers: text.headers, body: body(""), parts: [text,
    { mime_type: "application/pdf", filename: "original.pdf", headers: [], body: { size: 56073, base64_url_content: null, content: null, attachment_id: attachmentId }, parts: null, read_attachment_supported: true }] };
  const result = pluginMessageToRawMail(input);
  assert.deepEqual(result.payload.parts[1].body, { size: 56073, attachmentId });
  assert.throws(() => createPluginBatchTransport({ ...batch(), messages: [result] }, account));
});

test("missing, shortened, cross-message or duplicate attachment bytes fail before serving any list", () => {
  for (const mutate of [value => value.attachments = [], value => value.attachments[0].size++, value => value.attachments[0].messageId = "other",
    value => value.attachments.push(value.attachments[0]), value => value.attachments[0].data = "", value => value.attachments[0].data = "not valid base64!"]) {
    const value = attachedBatch(); mutate(value); assert.throws(() => createPluginBatchTransport(value, account));
  }
});

test("unsupported external text body and inline named attachment stop rather than disappear", () => {
  rejectsBatch(value => value.messages[0].payload.body = { size: 8, attachmentId: "external" });
  rejectsBatch(value => value.messages[0].payload.filename = "inline.html");
});

test("PC Express complete MIME beyond generic 12k normalization still reaches its original parser", async () => {
  const content = `<html><body>${" ".repeat(20_000)}<p>N° de commande 531900000000001</p><p>Bonjour Sample, votre commande a été livrée!</p><p>Vous pouvez consulter les détails de votre commande en ligne en tout temps.</p></body></html>`;
  const input = plugin("abcdef123456", content);
  input.payload.headers[0].value = "PC Express <noreply@t.pcexpress.ca>";
  input.payload.headers[1].value = "Votre commande a été livrée! \u{1f389}";
  const value = batch(); value.messages = [pluginMessageToRawMail(input)];
  const { token, gmail } = createPluginBatchTransport(value, account);
  const raw = await gmail(token, "messages/abcdef123456?format=full");
  assert.equal(Buffer.from(raw.payload.body.data, "base64url").toString(), content);
  const result = parsePcExpressMail(raw, account);
  assert.equal(result.kind, "delivered"); assert.equal(result.orderId, "531900000000001"); assert.equal(result.messageId, input.id);
});

test("Blue Cross tables retain full HTML before the existing classifier text cap", async () => {
  const table = '<table id="grdClaimsGrid"><thead><tr><th>Amount Claimed</th><th>Amount Paid</th></tr></thead><tbody><tr rowId="0"><td>Sep 03, 2026</td><td>Synthetic Person</td><td>Physiotherapy Treatment</td><td>$100.00</td><td>$80.00</td><td>Sep 03, 2026</td><td>Details</td></tr></tbody><tfoot><tr><td></td><td></td><td><div>Page 1 Total</div><div>Grand Total</div></td><td><div>$100.00</div><div>$100.00</div></td><td><div>$80.00</div><div>$80.00</div></td></tr></tfoot></table>';
  const input = plugin("abcdef123456", "x".repeat(16_000) + table); input.payload.headers[1].value = "Blue Cross refund";
  const value = batch(); value.messages = [pluginMessageToRawMail(input)];
  const { token, gmail } = createPluginBatchTransport(value, account);
  const normalized = normalizeMail(await gmail(token, "messages/abcdef123456?format=full"));
  assert.equal(normalized.text.length, 12000);
  assert.equal(normalized.blueCrossExport.rows.length, 1);
  assert.equal(normalized.blueCrossExport.rows[0].paid, 80);
});

test("oversized attachment metadata count cannot silently hit normalizeMail's 30-file cap", () => {
  const value = attachedBatch(), leaf = value.messages[0].payload.parts[1];
  value.messages[0].payload.parts = Array(31).fill(leaf);
  assert.throws(() => createPluginBatchTransport(value, account));
});

test("cyclic page chains and result duplication across pages cannot certify completion", () => {
  rejectsBatch(value => value.queries[0].pages = [
    { messageIds: ["abcdef123456"], nextPageToken: "cycle" },
    { pageToken: "cycle", messageIds: [], nextPageToken: "cycle" },
    { pageToken: "cycle", messageIds: [] }]);
  rejectsBatch(value => value.queries[0].pages = [
    { messageIds: ["abcdef123456"], nextPageToken: "next" },
    { pageToken: "next", messageIds: ["abcdef123456"] }]);
});
