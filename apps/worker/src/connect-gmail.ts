import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { credentialPath, type GmailCredentials, gmail } from "./gmail-client.js";
import { loadPrivate, savePrivate } from "./private-store.js";

const rl = createInterface({ input: stdin, output: stdout });
try {
  const path = (await rl.question("Path to downloaded Google Desktop OAuth client JSON (kept on this PC): ")).trim().replace(/^"|"$/g, "");
  const config = JSON.parse(await readFile(path, "utf8")) as { installed?: { client_id: string; client_secret: string } };
  if (!config.installed?.client_id || !config.installed.client_secret) throw new Error("Select a Desktop app OAuth client JSON, not a Web client.");
  const label = (await rl.question("Account label (Kevin / Jasmine): ")).trim().slice(0, 40);
  if (!label) throw new Error("An account label is required.");
  const verifier = randomBytes(48).toString("base64url"); const state = randomBytes(32).toString("base64url");
  let resolveCode!: (code: string) => void; let rejectCode!: (error: Error) => void;
  const codePromise = new Promise<string>((resolve, reject) => { resolveCode = resolve; rejectCode = reject; });
  const server = createServer((request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (url.pathname !== "/oauth2/callback" || url.searchParams.get("state") !== state) { response.writeHead(400).end("Invalid authorization callback."); return; }
    response.setHeader("Content-Type", "text/plain; charset=utf-8"); response.setHeader("Cache-Control", "no-store");
    const code = url.searchParams.get("code");
    if (!code) { response.end("Authorization cancelled."); rejectCode(new Error("Google authorization was cancelled.")); }
    else { response.end("Authorization received. Return to the FamilyHub setup terminal."); resolveCode(code); }
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = (server.address() as { port: number }).port;
  const redirect = `http://127.0.0.1:${port}/oauth2/callback`;
  const params = new URLSearchParams({ client_id: config.installed.client_id, redirect_uri: redirect, response_type: "code",
    scope: "https://www.googleapis.com/auth/gmail.readonly", access_type: "offline", prompt: "consent select_account",
    state, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" });
  console.log("Open this URL in a browser ON THIS PC and approve read-only Gmail access:\nhttps://accounts.google.com/o/oauth2/v2/auth?" + params);
  const timer = setTimeout(() => rejectCode(new Error("Google authorization timed out.")), 10 * 60_000);
  let code: string;
  try { code = await codePromise; } finally { clearTimeout(timer); server.close(); }
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", signal: AbortSignal.timeout(30_000),
    body: new URLSearchParams({ code, client_id: config.installed.client_id, client_secret: config.installed.client_secret,
      redirect_uri: redirect, grant_type: "authorization_code", code_verifier: verifier }) });
  if (!response.ok) throw new Error("Google could not exchange the authorization code.");
  const tokens = await response.json() as { access_token?: string; refresh_token?: string; scope?: string };
  if (!tokens.access_token || !tokens.refresh_token || !tokens.scope?.split(" ").includes("https://www.googleapis.com/auth/gmail.readonly")) throw new Error("Read-only offline Gmail access was not granted. Repeat setup and approve Gmail access.");
  const profile = await gmail<{ emailAddress: string }>(tokens.access_token, "profile");
  let saved: GmailCredentials = { accounts: [] };
  try { saved = await loadPrivate<GmailCredentials>(credentialPath); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const email = profile.emailAddress.toLowerCase();
  saved.accounts = saved.accounts.filter(x => x.email.toLowerCase() !== email);
  saved.accounts.push({ email, label, clientId: config.installed.client_id, clientSecret: config.installed.client_secret, refreshToken: tokens.refresh_token });
  await savePrivate(credentialPath, saved);
  console.log("Gmail connected. The refresh token is protected with Windows DPAPI for this user. No token was printed.");
} catch (error) { console.error(error instanceof Error ? error.message : "Gmail setup failed."); process.exitCode = 1; }
finally { rl.close(); }
