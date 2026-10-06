import { access, mkdir, readFile, unlink, rmdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "playwright";
import { atomicJson, dataDirectory, loadPrivate } from "./private-store.js";

export type Insurer = "bluecross" | "desjardins";
export type LoginReason = "not-configured" | "credentials-unavailable" | "credentials-rejected" | "human-required" | "layout-changed" | "cooldown" | "profile-busy" | "profile-selection-required" | "login-incomplete";
export type LoginCredentials = { version: 1; insurer: Insurer; password: string; username?: string; policy?: string; certificate?: string; role?: "member" | "spouse" };
type LoginControl = { blocked: boolean; reason?: LoginReason; attemptedAt?: string };
export const loginDirectory = (insurer: Insurer) => join(dataDirectory, insurer);
const controlPath = (insurer: Insurer) => join(loginDirectory(insurer), "login-control.json");
export const credentialPath = (insurer: Insurer) => join(loginDirectory(insurer), "login.dpapi");

/** Shared by collector and local configuration. Never steal a possibly live browser lock. */
export async function acquirePortalLock(insurer: Insurer): Promise<() => Promise<void>> {
  const directory = loginDirectory(insurer);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "collector-lock");
  try { await mkdir(path, { mode: 0o700 }); }
  catch { throw new Error("Insurer browser profile is busy. Close its active collection, or recover the interrupted lock locally."); }
  try { await writeFile(join(path, "owner.json"), JSON.stringify({ pid: process.pid }), { flag: "wx", mode: 0o600 }); }
  catch { await rmdir(path).catch(() => {}); throw new Error("Could not secure the insurer profile lock."); }
  return async () => { await unlink(join(path, "owner.json")); await rmdir(path); };
}
export function validCredentials(value: unknown, insurer: Insurer): value is LoginCredentials {
  if (!value || typeof value !== "object") return false;
  const entry = value as LoginCredentials;
  const valid = (text: unknown) => typeof text === "string" && text.length > 0 && text.length <= 512 && !/[\r\n\0]/.test(text);
  return entry.version === 1 && entry.insurer === insurer && valid(entry.password) && (insurer === "desjardins"
    ? valid(entry.username) : valid(entry.policy) && valid(entry.certificate) && ["member", "spouse"].includes(entry.role || ""));
}
export async function hasPortalCredentials(insurer: Insurer): Promise<boolean> {
  try { await access(credentialPath(insurer)); return true; } catch { return false; }
}
export async function readLoginControl(insurer: Insurer): Promise<LoginControl> {
  try {
    const state = JSON.parse(await readFile(controlPath(insurer), "utf8"));
    if (typeof state.blocked !== "boolean" || (state.reason && !["not-configured", "credentials-unavailable", "credentials-rejected", "human-required", "layout-changed", "cooldown", "profile-busy", "profile-selection-required", "login-incomplete"].includes(state.reason)) || (state.attemptedAt && !Number.isFinite(Date.parse(state.attemptedAt)))) throw new Error();
    return state;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { blocked: false };
    // Corrupt retry state must never turn into permission to retry a password.
    return { blocked: true, reason: "credentials-unavailable" };
  }
}
export async function authenticatedPortal(insurer: Insurer): Promise<void> {
  const previous = await readLoginControl(insurer);
  await atomicJson(controlPath(insurer), { blocked: false, attemptedAt: previous.attemptedAt });
}
export function loginGate(state: LoginControl, now = Date.now()): LoginReason | undefined {
  if (state.blocked) return state.reason || "login-incomplete";
  if (state.attemptedAt && now - Date.parse(state.attemptedAt) < 30 * 60_000) return "cooldown";
}
export function allowedLoginUrl(insurer: Insurer, url: string): boolean {
  try {
    const parsed = new URL(url);
    return !parsed.username && !parsed.password && (insurer === "bluecross"
      ? parsed.origin === "https://service.pac.bluecross.ca" && /^\/member\/login\/?$/i.test(parsed.pathname)
      : parsed.origin === "https://id.desjardins.com" && parsed.pathname === "/login");
  } catch { return false; }
}
export function classifyLoginScreen(text: string): LoginReason | undefined {
  if (/incorrect password|invalid (?:username|password|credentials)|identifiant.*(?:incorrect|invalide)|mot de passe.*(?:incorrect|invalide)|account.*locked|compte.*bloqu/i.test(text)) return "credentials-rejected";
  if (/verification code|security code|one.time (?:code|password)|multi.factor|two.step|code de (?:v[ée]rification|s[ée]curit[ée])|authentification.{0,20}facteur|captcha|verify you are human|v[ée]rifier votre identit[ée]/i.test(text)) return "human-required";
}

// UI values are never returned or logged. The exact HTTPS origins and observed form types
// are checked before every fill and the single submit. No password-reset or MFA action exists.
export type LoginPhase = "checking-form" | "filling-username" | "filling-password" | "submitting" | "awaiting-history" | "authenticated" | "retry-blocked";
export type LoginDiagnostic = { version: 1; observedAt: string; phase: LoginPhase; errorKind?: "timeout" | "form-changed" | "browser-error"; reason?: LoginReason; location: "login-form" | "insurer-portal" | "other"; passwordVisible: boolean; challengeVisible: boolean; landingHost: string; browserError: boolean };

export async function submitPortalLogin(page: Page, insurer: Insurer, credentials: LoginCredentials, phase?: (value: LoginPhase) => void): Promise<void> {
  phase?.("checking-form");
  const guard = () => { if (!allowedLoginUrl(insurer, page.url())) throw new Error("Login form changed."); };
  guard();
  const fields = insurer === "bluecross"
    ? [["#policy", credentials.policy!], ["#certificate", credentials.certificate!], ["#password", credentials.password]]
    : [["#UserName", credentials.username!], ["#Password", credentials.password]];
  for (const [selector] of fields) {
    const field = page.locator(selector);
    if (await field.count() !== 1 || !await field.isVisible() || !await field.isEditable()
      || await field.getAttribute("type") !== (/password/i.test(selector) ? "password" : "text")) throw new Error("Login form changed.");
  }
  for (const [selector, value] of fields) { guard(); phase?.(/password/i.test(selector) ? "filling-password" : "filling-username"); await page.locator(selector).fill(value, { timeout: 5000 }); }
  if (insurer === "bluecross") {
    guard();
    await page.locator('input[name="spouse"][value="' + (credentials.role === "spouse" ? "1" : "0") + '"]').check({ timeout: 5000 });
  }
  guard();
  const submit = insurer === "bluecross" ? page.getByRole("button", { name: /^Login$/i }) : page.locator("#submitButton[type=submit]");
  phase?.("submitting");
  await submit.click({ timeout: 10_000 });
}

type LoginDependencies = {
  read: (insurer: Insurer) => Promise<LoginControl>;
  save: (insurer: Insurer, value: LoginControl) => Promise<void>;
  credentials: (insurer: Insurer) => Promise<unknown>;
  submit: typeof submitPortalLogin;
  now: () => number;
  diagnose?: (insurer: Insurer, value: LoginDiagnostic) => Promise<void>;
};
const defaults: LoginDependencies = {
  read: readLoginControl, save: (insurer, value) => atomicJson(controlPath(insurer), value),
  credentials: insurer => loadPrivate(credentialPath(insurer)), submit: submitPortalLogin, now: Date.now,
  diagnose: (insurer, value) => atomicJson(join(loginDirectory(insurer), "login-diagnostic.json"), value)
};
/** One attempt only; latch BEFORE submission, including ambiguous timeout/crash outcomes. Caller owns profile lock. */
export async function tryPortalLogin(page: Page, insurer: Insurer, ready: () => Promise<boolean>, deps: LoginDependencies = defaults): Promise<LoginReason | undefined> {
  let phase: LoginPhase = "checking-form";
  const diagnose = async (reason?: LoginReason, errorKind?: LoginDiagnostic["errorKind"]) => {
    if (!deps.diagnose) return;
    try {
      let portal = false;
      let landingHost = "unrecognized", browserError = false;
      try { const url = new URL(page.url()); browserError = ["chrome-error:", "edge-error:"].includes(url.protocol);
        if (url.protocol === "https:" && /(?:^|\.)(?:desjardins\.com|dsf-dfs\.com)$/i.test(url.hostname)) landingHost = url.hostname;
        else if (url.protocol === "about:") landingHost = "blank";
        else if (browserError) landingHost = "browser-error";
      } catch {}
      try { portal = new URL(page.url()).origin === (insurer === "desjardins" ? "https://www.agea-gbim.dsf-dfs.com" : "https://service.pac.bluecross.ca"); } catch {}
      const visible = async (selector: string) => page.locator(selector).first().isVisible().catch(() => false);
      await deps.diagnose(insurer, { version: 1, observedAt: new Date(deps.now()).toISOString(), phase, reason, errorKind, landingHost, browserError,
        location: allowedLoginUrl(insurer, page.url()) ? "login-form" : portal ? "insurer-portal" : "other",
        passwordVisible: await visible(insurer === "desjardins" ? "#Password" : "#password"),
        challengeVisible: classifyLoginScreen(await page.locator("body").innerText().catch(() => "")) === "human-required"
          || await visible('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], input[autocomplete="one-time-code"]') });
    } catch { /* Secret-free diagnostics cannot grant retries or disrupt authentication. */ }
  };
  // Wait for the reused session or a rendered login/challenge, not a transient redirect.
  const restoreDeadline = deps.now() + 20_000;
  while (!await ready()) {
    const password = page.locator(insurer === "bluecross" ? "#password" : "#Password");
    if (allowedLoginUrl(insurer, page.url()) && await password.isVisible().catch(() => false)) break;
    if (classifyLoginScreen(await page.locator("body").innerText().catch(() => ""))) break;
    if (deps.now() >= restoreDeadline) break;
    await page.waitForTimeout(1000);
  }
  if (await ready()) return undefined;
  const previous = await deps.read(insurer);
  const gate = loginGate(previous, deps.now());
  if (gate) { phase = "retry-blocked"; await diagnose(gate); return gate; }
  const screenReason = classifyLoginScreen(await page.locator("body").innerText().catch(() => ""));
  const captcha = await page.locator('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], input[autocomplete="one-time-code"]').first().isVisible().catch(() => false);
  if (screenReason || captcha) {
    const reason = screenReason || "human-required";
    await deps.save(insurer, { ...previous, blocked: true, reason });
    return reason;
  }
  if (!allowedLoginUrl(insurer, page.url())) return "layout-changed";
  let credentials: unknown;
  try { credentials = await deps.credentials(insurer); }
  catch (error) { return (error as NodeJS.ErrnoException).code === "ENOENT" ? "not-configured" : "credentials-unavailable"; }
  if (!validCredentials(credentials, insurer)) return "credentials-unavailable";
  const attemptedAt = new Date(deps.now()).toISOString();
  await deps.save(insurer, { blocked: true, reason: "login-incomplete", attemptedAt });
  let reason: LoginReason = "login-incomplete";
  try {
    await deps.submit(page, insurer, credentials, value => { phase = value; });
    phase = "awaiting-history";
    const deadline = deps.now() + 30_000;
    while (deps.now() < deadline) {
      if (await ready()) { await deps.save(insurer, { blocked: false, attemptedAt }); phase = "authenticated"; await diagnose(); return undefined; }
      const detected = classifyLoginScreen(await page.locator("body").innerText().catch(() => ""));
      if (detected) { reason = detected; break; }
      await page.waitForTimeout(1000);
    }
  } catch (error) {
    const kind = error instanceof Error && error.message === "Login form changed." ? "form-changed"
      : error instanceof Error && error.name === "TimeoutError" ? "timeout" : "browser-error";
    credentials = undefined;
    await deps.save(insurer, { blocked: true, reason, attemptedAt });
    await diagnose(reason, kind);
    return reason;
  }
  credentials = undefined;
  await deps.save(insurer, { blocked: true, reason, attemptedAt });
  await diagnose(reason);
  return reason;
}
