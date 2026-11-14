import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, unlink } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { dataDirectory } from "./private-store.js";

export const MAX_MAIL_ATTACHMENT_BYTES = 20_000_000;
export type MailAttachmentSource = {
  account: string; messageId: string; attachmentId: string; filename: string; mimeType: string; size: number;
};
export type MailAttachmentReference = MailAttachmentSource & { sha256: string };
const fields = ["account", "messageId", "attachmentId", "filename", "mimeType", "size"] as const;
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const invalid = () => new Error("Invalid mail attachment source or bytes.");
function validate(source: MailAttachmentSource): void {
  if (!source || typeof source !== "object"
    || typeof source.account !== "string" || source.account.length > 320
    || !/^[^\s@]+@[^\s@]+$/.test(source.account) || source.account !== source.account.toLowerCase()
    || typeof source.messageId !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(source.messageId)
    || typeof source.attachmentId !== "string" || !/^[A-Za-z0-9_-]{1,1500}$/.test(source.attachmentId)
    || typeof source.filename !== "string" || source.filename.length > 255 || source.filename.includes("\0")
    || typeof source.mimeType !== "string" || source.mimeType.length > 255
    || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(source.mimeType)
    || source.filename === "" && /^text\//i.test(source.mimeType)
    || !Number.isSafeInteger(source.size) || source.size < 0 || source.size > MAX_MAIL_ATTACHMENT_BYTES) throw invalid();
}
function match(expected: MailAttachmentSource, actual: MailAttachmentSource): void {
  validate(expected); validate(actual);
  if (fields.some(field => expected[field] !== actual[field])) throw invalid();
}
function snapshot(source: MailAttachmentSource): MailAttachmentSource {
  return { account: source.account, messageId: source.messageId, attachmentId: source.attachmentId,
    filename: source.filename, mimeType: source.mimeType, size: source.size };
}
function validateReference(reference: MailAttachmentReference): void {
  validate(reference);
  if (typeof reference.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(reference.sha256)) throw invalid();
}
async function boundedRead(path: string, limit: number): Promise<Buffer> {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit) throw invalid();
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size > limit) throw invalid();
    // Bounded even if a damaged file grows concurrently. No parsing/execution of attachment contents.
    const bytes = Buffer.alloc(opened.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (result.bytesRead === 0) break;
      offset += result.bytesRead;
    }
    if (offset !== opened.size) throw invalid();
    return bytes.subarray(0, offset);
  } finally { await handle.close(); }
}

/** Private inert originals, separate from connector-documents. Directory is trusted
 * application configuration only, never an intake payload field. Its ancestors must
 * be protected against concurrent replacement by the operator. This is not encryption
 * or proof of upstream authenticity. Do not expose the cache without existing pairing.
 */
export function createMailAttachmentCache(directory = join(dataDirectory, "mail-attachments")) {
  if (!isAbsolute(directory)) throw new Error("Mail attachment cache requires an absolute trusted directory.");
  async function checkDirectory(create: boolean): Promise<void> {
    if (create) await mkdir(directory, { recursive: true, mode: 0o700 });
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Invalid mail attachment cache directory.");
  }
  function manifestPath(source: MailAttachmentSource): string {
    // Never put mailbox identifiers or filenames in filesystem paths.
    const key = digest(Buffer.from(JSON.stringify([source.account, source.messageId, source.attachmentId])));
    return join(directory, key + ".source.json");
  }
  async function publish(path: string, bytes: Buffer): Promise<void> {
    const temporary = join(directory, randomUUID() + ".tmp");
    const handle = await open(temporary, "wx", 0o600);
    try {
      try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
      // Atomic no-replace publication, including concurrent saves. No partial originals.
      try { await link(temporary, path); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    } finally { await unlink(temporary); }
  }
  async function lookup(expected: MailAttachmentSource): Promise<MailAttachmentReference> {
    validate(expected);
    const source = snapshot(expected);
    try {
      await checkDirectory(false);
      const saved = JSON.parse((await boundedRead(manifestPath(source), 16_384)).toString("utf8"));
      if (saved?.schema !== 1) throw invalid();
      match(source, saved.reference); validateReference(saved.reference);
      return { ...snapshot(saved.reference), sha256: saved.reference.sha256 };
    } catch { throw new Error("Mail attachment source missing, corrupt or conflicting; original bytes are unavailable."); }
  }
  async function read(reference: MailAttachmentReference, expected: MailAttachmentSource): Promise<Buffer> {
    match(expected, reference); validateReference(reference);
    const saved = { ...snapshot(reference), sha256: reference.sha256 };
    try {
      await checkDirectory(false);
      const bytes = await boundedRead(join(directory, saved.sha256 + ".bin"), saved.size);
      if (bytes.length !== saved.size || digest(bytes) !== saved.sha256) throw invalid();
      return bytes;
    } catch { throw new Error("Mail attachment cache missing or corrupt; original bytes are unavailable."); }
  }
  async function readSource(expected: MailAttachmentSource): Promise<Buffer> {
    validate(expected);
    const source = snapshot(expected);
    return read(await lookup(source), source);
  }
  async function save(expected: MailAttachmentSource, actual: MailAttachmentSource & { bytes: Buffer }): Promise<MailAttachmentReference> {
    match(expected, actual);
    if (!Buffer.isBuffer(actual.bytes) || actual.bytes.length !== expected.size) throw invalid();
    // Snapshot before the first await, preventing caller mutation mid-write.
    const bytes = Buffer.from(actual.bytes);
    const reference = { ...snapshot(expected), sha256: digest(bytes) };
    await checkDirectory(true);
    await publish(join(directory, reference.sha256 + ".bin"), bytes);
    await read(reference, reference);
    await publish(manifestPath(reference), Buffer.from(JSON.stringify({ schema: 1, reference })));
    const saved = await lookup(reference);
    if (saved.sha256 !== reference.sha256) throw new Error("Mail attachment source conflicts with its saved original.");
    return reference;
  }
  return { save, read, lookup, readSource };
}
