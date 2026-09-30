import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PDFParse } from "pdf-parse";
import { dataDirectory } from "./private-store.js";
import type { Mail } from "./invoice-model.js";

// Connector credentials never enter the worker. Original documents are stored under
// content hashes, not caller-supplied paths, and served through the paired API.
export type ConnectorAttachment = { id: string; name: string; mime: string; base64: string };
export type ConnectorMessage = { account: string; label: string; since: string; through: string;
  mail: Mail; files: ConnectorAttachment[]; invoiceAttachmentId?: string };
const cache = join(dataDirectory, "connector-documents");
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
export async function prepareConnectorMessage(input: unknown): Promise<{ account: string; label: string; invoiceAttachmentId?: string; mail: Mail; files: { hash: string; bytes: Buffer }[] }> {
  if (!input || typeof input !== "object") throw new Error("Provide a connector message.");
  const value = input as ConnectorMessage;
  if (typeof value.account !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.account) || value.account.length > 254) throw new Error("Invalid source account.");
  if (typeof value.label !== "string" || value.label.length > 100) throw new Error("Invalid source label.");
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value.since) || !/^\d{4}-\d{2}-\d{2}T/.test(value.through)) throw new Error("Provide an explicit collection window with timezone.");
  const start = Date.parse(value.since), end = Date.parse(value.through);
  const source = value.mail;
  const received = Date.parse(source?.receivedAt);
  if (![start, end, received].every(Number.isFinite) || end <= start || received < start || received >= end) throw new Error("Message is outside the collection window.");
  if (!source || typeof source.id !== "string" || !/^[a-f0-9]{8,32}$/i.test(source.id) || typeof source.threadId !== "string") throw new Error("Invalid Gmail source identity.");
  for (const field of ["subject", "sender", "text", "internetMessageId"] as const)
    if (typeof source[field] !== "string" || source[field].length > (field === "text" ? 100_000 : 1000)) throw new Error("Invalid message evidence.");
  if (!Array.isArray(source.labels) || source.labels.some(label => typeof label !== "string") || source.labels.some(label => ["SENT", "DRAFT", "SPAM", "TRASH"].includes(label))) throw new Error("Excluded mailbox message.");
  if (!Array.isArray(source.attachments) || source.attachments.length > 30 || !Array.isArray(value.files) || value.files.length > 30) throw new Error("Invalid attachments.");
  const ids = new Set<string>();
  let attachments = source.attachments.map(a => {
    if (!a || typeof a.Id !== "string" || !a.Id || a.Id.length > 1500 || ids.has(a.Id) || typeof a.FileName !== "string" || a.FileName.length > 255 || typeof a.MimeType !== "string" || !Number.isFinite(a.Size) || a.Size < 0) throw new Error("Invalid attachment metadata.");
    ids.add(a.Id);
    return { Id: a.Id, FileName: a.FileName, MimeType: a.MimeType, Size: a.Size, AnalysisStatus: "unsupported" as "unsupported" | "failed" | "text-extracted", ExtractedCharacters: 0, LocalSha256: undefined as string | undefined };
  });
  if (value.invoiceAttachmentId != null) {
    if (typeof value.invoiceAttachmentId !== "string" || !attachments.some(a => a.Id === value.invoiceAttachmentId && a.MimeType === "application/pdf")) throw new Error("Select an original PDF attachment from this message.");
    attachments = attachments.filter(a => a.Id === value.invoiceAttachmentId);
    if (value.files.length !== 1 || value.files[0].id !== value.invoiceAttachmentId) throw new Error("Provide only the selected invoice PDF.");
  } else if (attachments.filter(a => a.MimeType === "application/pdf").length > 1) {
    throw new Error("This email has multiple PDFs. Select each invoice separately to avoid combining different patients or amounts.");
  }
  const chunks: string[] = [], files: { hash: string; bytes: Buffer }[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (const f of value.files) {
    const a = attachments.find(a => a.Id === f.id);
    if (!a || seen.has(f.id) || f.name !== a.FileName || f.mime !== a.MimeType || typeof f.base64 !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(f.base64)) throw new Error("Attachment does not match its source.");
    seen.add(f.id);
    const bytes = Buffer.from(f.base64, "base64");
    total += bytes.length;
    if (!bytes.length || bytes.length !== a.Size || total > 20_000_000) throw new Error("Attachment size mismatch or limit exceeded.");
    if (f.mime !== "application/pdf" || !bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error("Only original PDF documents can be cached.");
    const hash = digest(bytes);
    a.LocalSha256 = hash;
    files.push({ hash, bytes });
    const parser = new PDFParse({ data: new Uint8Array(bytes) });
    try {
      const text = (await parser.getText()).text.replace(/\0/g, " ").trim();
      a.AnalysisStatus = text ? "text-extracted" : "failed";
      a.ExtractedCharacters = text.length;
      chunks.push(`${a.FileName}: ${text.slice(0, 24_000)}`);
    } catch { a.AnalysisStatus = "failed"; }
    finally { await parser.destroy(); }
  }
  return { account: value.account.toLowerCase(), label: value.label, invoiceAttachmentId: value.invoiceAttachmentId, files,
    mail: { id: source.id, threadId: source.threadId, internetMessageId: source.internetMessageId,
      subject: source.subject, sender: source.sender, receivedAt: source.receivedAt,
      text: value.invoiceAttachmentId ? "Invoice evidence is the selected original PDF. Other attachments and email amounts are intentionally excluded." : source.text.slice(0, 24_000), labels: source.labels, unsubscribe: Boolean(source.unsubscribe), bulk: Boolean(source.bulk),
      attachments, attachmentText: chunks.join("\n").slice(0, 48_000) } };
}
export async function saveConnectorFiles(files: { hash: string; bytes: Buffer }[]): Promise<void> {
  await mkdir(cache, { recursive: true });
  for (const file of files) {
    try { await writeFile(join(cache, file.hash + ".pdf"), file.bytes, { flag: "wx", mode: 0o600 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (digest(await readFile(join(cache, file.hash + ".pdf"))) !== file.hash) throw new Error("Stored document integrity check failed."); }
  }
}
export async function readConnectorFile(hash: string): Promise<Buffer> {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid document reference.");
  const bytes = await readFile(join(cache, hash + ".pdf"));
  if (digest(bytes) !== hash) throw new Error("Stored document integrity check failed.");
  return bytes;
}
