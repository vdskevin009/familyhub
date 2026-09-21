import { join } from "node:path";
import { loadPrivate, dataDirectory } from "./private-store.js";
import type { Attachment, Mail } from "./invoice-model.js";

export type GmailAccount = { email: string; label: string; clientId: string; clientSecret: string; refreshToken: string };
export type GmailCredentials = { accounts: GmailAccount[] };
export const credentialPath = join(dataDirectory, "gmail-credentials.dpapi");
export async function credentials(): Promise<GmailCredentials> {
  try { return await loadPrivate<GmailCredentials>(credentialPath); }
  catch { throw new Error("Connect Gmail on this PC using scripts/Connect-Gmail.ps1 before enabling daily collection."); }
}
export async function accessToken(account: GmailAccount): Promise<string> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", signal: AbortSignal.timeout(30_000),
    body: new URLSearchParams({ client_id: account.clientId, client_secret: account.clientSecret, refresh_token: account.refreshToken, grant_type: "refresh_token" })
  });
  if (!response.ok) throw new Error("Gmail authorization expired or was rejected. Reconnect this account on the PC.");
  const data = await response.json() as { access_token?: string };
  if (!data.access_token) throw new Error("Google did not return an access token.");
  return data.access_token;
}
export async function gmail<T>(token: string, path: string): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/" + path, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000)
    });
    if (response.ok) return await response.json() as T;
    if ((response.status === 429 || response.status >= 500) && attempt < 3) {
      await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt)); continue;
    }
    throw new Error(`Gmail request failed (${response.status}). No collection checkpoint was advanced for this page.`);
  }
  throw new Error("Gmail temporarily unavailable.");
}
type Part = { mimeType?: string; filename?: string; headers?: { name: string; value: string }[];
  body?: { data?: string; attachmentId?: string; size?: number }; parts?: Part[] };
export type RawMail = { id: string; threadId: string; internalDate?: string; labelIds?: string[]; snippet?: string; payload?: Part };
export function normalizeMail(raw: RawMail): Mail {
  const header = (name: string) => raw.payload?.headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || "";
  const attachments: Attachment[] = [];
  const plain: string[] = []; const html: string[] = [];
  const walk = (part: Part) => {
    if (part.filename && part.body?.attachmentId) attachments.push({ Id: part.body.attachmentId, FileName: part.filename.slice(0, 255), MimeType: part.mimeType || "application/octet-stream", Size: part.body.size || 0 });
    if (!part.filename && part.body?.data) {
      const decoded = Buffer.from(part.body.data, "base64url").toString("utf8");
      if (part.mimeType === "text/plain") plain.push(decoded);
      else if (part.mimeType === "text/html") html.push(decoded.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&amp;|&#\d+;/g, " "));
    }
    for (const child of part.parts || []) walk(child);
  };
  if (raw.payload) walk(raw.payload);
  const stamp = Number(raw.internalDate);
  return { id: raw.id, threadId: raw.threadId, internetMessageId: header("message-id"), subject: header("subject").slice(0, 500), sender: header("from").slice(0, 500),
    receivedAt: Number.isFinite(stamp) ? new Date(stamp).toISOString() : new Date().toISOString(),
    text: (plain.join("\n") || html.join("\n") || raw.snippet || "").slice(0, 12_000),
    labels: raw.labelIds || [], unsubscribe: !!header("list-unsubscribe"), bulk: /bulk|list/i.test(header("precedence")), attachments: attachments.slice(0, 30) };
}
