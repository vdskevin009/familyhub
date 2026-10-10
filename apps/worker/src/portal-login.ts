import { access, mkdir, readFile, unlink, rmdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "playwright";
import { atomicJson, dataDirectory, loadPrivate } from "./private-store.js";

export type Insurer = "bluecross" | "desjardins";
export type LoginReason = "not-configured" | "credentials-unavailable" | "credentials-rejected" | "human-required" | "layout-changed" | "cooldown" | "profile-busy" | "profile-selection-required" | "login-incomplete";
export type LoginCredentials = { version: 1; insurer: Insurer; password: string; username?: string; policy?: string; certificate?: string; role?: "member" | "spouse" };
type LoginControl = { blocked: boolean; reason?: LoginReason; attemptedAt?: string; firstFailure?: LoginFailure };
type LoginFailure = { observedAt: string; phase: LoginPhase; reason: LoginReason; outcome: "preflight" | "rejection" | "human-required" | "uncertain"; errorKind?: LoginDiagnostic["errorKind"] };
const phases = ["checking-form", "transmission-starting", "filling-username", "filling-password", "submitting", "awaiting-history", "authenticated", "retry-blocked"];
function validFailure(value: unknown): value is LoginFailure {
  if (!value || typeof value !== "object") return false;
  const entry = value as LoginFailure;
  return Object.keys(entry).every(key => ["observedAt", "phase", "reason", "outcome", "errorKind"].includes(key))
    && typeof entry.observedAt === "string" && Number.isFinite(Date.parse(entry.observedAt))
    && phases.includes(entry.phase)
    && ["layout-changed", "login-incomplete", "credentials-rejected", "human-required"].includes(entry.reason)
    && ["preflight", "rejection", "human-required", "uncertain"].includes(entry.outcome)
    && (!entry.errorKind || ["timeout", "form-changed", "browser-error"].includes(entry.errorKind));
}
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
    if (state.firstFailure !== undefined && !validFailure(state.firstFailure)) throw new Error();
    return state;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { blocked: false };
    // Corrupt retry state must never turn into permission to retry a password.
    return { blocked: true, reason: "credentials-unavailable" };
  }
}
export async function authenticatedPortal(insurer: Insurer): Promise<void> {
  const previous = await readLoginControl(insurer);
  await atomicJson(controlPath(insurer), { blocked: false, attemptedAt: previous.attemptedAt, ...(previous.firstFailure ? { firstFailure: previous.firstFailure } : {}) });
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
export type LoginPhase = "checking-form" | "transmission-starting" | "filling-username" | "filling-password" | "submitting" | "awaiting-history" | "authenticated" | "retry-blocked";
export type LoginDiagnostic = { version: 1; originalFailure?: LoginFailure; originalFailureUnavailable?: boolean; observedAt: string; phase: LoginPhase; errorKind?: "timeout" | "form-changed" | "browser-error"; reason?: LoginReason; location: "login-form" | "insurer-portal" | "other"; passwordVisible: boolean; challengeVisible: boolean; landingHost: string; browserError: boolean };

/** An explicit proof from a read-only preflight, never inferred from missing logs. */
class PortalLoginPreflightError extends Error {
  constructor(readonly errorKind: NonNullable<LoginDiagnostic["errorKind"]>) { super("Login form changed."); }
}
function errorKind(error: unknown): NonNullable<LoginDiagnostic["errorKind"]> {
  return error instanceof Error && error.message === "Login form changed." ? "form-changed"
    : error instanceof Error && error.name === "TimeoutError" ? "timeout" : "browser-error";
}
export async function submitPortalLogin(page: Page, insurer: Insurer, credentials: LoginCredentials, phase?: (value: LoginPhase) => void, beforeTransmission?: () => Promise<void>): Promise<void> {
  phase?.("checking-form");
  const guard = () => { if (!allowedLoginUrl(insurer, page.url())) throw new Error("Login form changed."); };
  const fields = insurer === "bluecross"
    ? [["#policy", credentials.policy!], ["#certificate", credentials.certificate!], ["#password", credentials.password]]
    : [["#UserName", credentials.username!], ["#Password", credentials.password]];
  // This block only reads DOM metadata. Its typed failure proves no field was filled.
  try {
    guard();
    for (const [selector] of fields) {
      guard();
      const field = page.locator(selector);
      if (await field.count() !== 1 || !await field.isVisible() || !await field.isEditable()
        || await field.getAttribute("type") !== (/password/i.test(selector) ? "password" : "text")) throw new Error("Login form changed.");
    }
    guard();
  } catch (error) { throw new PortalLoginPreflightError(errorKind(error)); }
  // An input event can already transmit an identifier/password. Persist the stop
  // before the first fill, not merely before clicking Submit.
  phase?.("transmission-starting");
  await beforeTransmission?.();
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
/** One attempt only; latch before ANY credential fill. Legacy/uncertain stops are never rearmed. Caller owns profile lock. */
export async function tryPortalLogin(page: Page, insurer: Insurer, ready: () => Promise<boolean>, deps: LoginDependencies = defaults): Promise<LoginReason | undefined> {
  let phase: LoginPhase = "checking-form";
  let originalFailure: LoginFailure | undefined;
  let originalFailureUnavailable = false;
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
        ...(originalFailure ? { originalFailure } : {}), ...(originalFailureUnavailable ? { originalFailureUnavailable: true } : {}),
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
    await page.waitForTimeout(1000).catch(() => new Promise(resolve => setTimeout(resolve, 1000)));
  }
  if (await ready()) return undefined;
  const previous = await deps.read(insurer);
  originalFailure = previous.firstFailure;
  originalFailureUnavailable = previous.blocked && !originalFailure;
  const failure = (reason: LoginReason, outcome: LoginFailure["outcome"], kind?: LoginDiagnostic["errorKind"]): LoginFailure => ({
    observedAt: new Date(deps.now()).toISOString(), phase, reason, outcome, ...(kind ? { errorKind: kind } : {})
  });
  const gate = loginGate(previous, deps.now());
  if (gate) { phase = "retry-blocked"; await diagnose(gate); return gate; }
  const screenReason = classifyLoginScreen(await page.locator("body").innerText().catch(() => ""));
  const captcha = await page.locator('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], input[autocomplete="one-time-code"]').first().isVisible().catch(() => false);
  if (screenReason || captcha) {
    const reason = screenReason || "human-required";
    originalFailure = failure(reason, reason === "credentials-rejected" ? "rejection" : "human-required");
    await deps.save(insurer, { ...previous, blocked: true, reason, firstFailure: originalFailure });
    await diagnose(reason);
    return reason;
  }
  if (!allowedLoginUrl(insurer, page.url())) return "layout-changed";
  let credentials: unknown;
  try { credentials = await deps.credentials(insurer); }
  catch (error) { return (error as NodeJS.ErrnoException).code === "ENOENT" ? "not-configured" : "credentials-unavailable"; }
  if (!validCredentials(credentials, insurer)) return "credentials-unavailable";
  let attemptedAt: string | undefined;
  let boundaryStarted = false, latchPersisted = false;
  let reason: LoginReason = "login-incomplete";
  try {
    await deps.submit(page, insurer, credentials, value => { phase = value; }, async () => {
      boundaryStarted = true;
      phase = "transmission-starting";
      attemptedAt = new Date(deps.now()).toISOString();
      originalFailure = failure("login-incomplete", "uncertain");
      await deps.save(insurer, { blocked: true, reason: "login-incomplete", attemptedAt, firstFailure: originalFailure });
      latchPersisted = true;
    });
    // Missing instrumentation never proves absence of transmission.
    if (!boundaryStarted) throw new Error("Login boundary was not recorded.");
    credentials = undefined;
    phase = "awaiting-history";
    const deadline = deps.now() + 30_000;
    while (deps.now() < deadline) {
      if (await ready()) {
        originalFailure = previous.firstFailure;
        await deps.save(insurer, { blocked: false, attemptedAt, ...(originalFailure ? { firstFailure: originalFailure } : {}) });
        phase = "authenticated"; await diagnose(); return undefined;
      }
      const detected = classifyLoginScreen(await page.locator("body").innerText().catch(() => ""));
      if (detected) { reason = detected; break; }
      await page.waitForTimeout(1000).catch(() => new Promise(resolve => setTimeout(resolve, 1000)));
    }
  } catch (error) {
    credentials = undefined;
    if (error instanceof PortalLoginPreflightError && !boundaryStarted) {
      // Only this instrumented read-only failure is recoverable. Do not change
      // attemptedAt or clear a legacy stop: legacy stops returned at the gate.
      originalFailure = failure("layout-changed", "preflight", error.errorKind);
      await deps.save(insurer, { ...previous, firstFailure: originalFailure });
      await diagnose("layout-changed", error.errorKind);
      return "layout-changed";
    }
    if (boundaryStarted && !latchPersisted) {
      // No fill can proceed when its durable guard could not be confirmed.
      await diagnose("credentials-unavailable");
      throw new Error("Could not persist the login attempt guard.");
    }
    attemptedAt ||= new Date(deps.now()).toISOString();
    originalFailure = failure(reason, "uncertain", errorKind(error));
    await deps.save(insurer, { blocked: true, reason, attemptedAt, firstFailure: originalFailure });
    await diagnose(reason, errorKind(error));
    return reason;
  }
  credentials = undefined;
  originalFailure = failure(reason, reason === "credentials-rejected" ? "rejection" : reason === "human-required" ? "human-required" : "uncertain");
  await deps.save(insurer, { blocked: true, reason, attemptedAt, firstFailure: originalFailure });
  await diagnose(reason);
  return reason;
}
