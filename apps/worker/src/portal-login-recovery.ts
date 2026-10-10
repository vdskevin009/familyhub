import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { atomicJson } from "./private-store.js";
import { loginDirectory, type Insurer, type LoginControl } from "./portal-login.js";

export type LoginRecoveryRequest = { requestId: string; expectedAttemptedAt: string; acknowledgeUncertainAttempt: true };
export function parseLoginRecoveryRequest(value: unknown): LoginRecoveryRequest {
  const request = value as LoginRecoveryRequest;
  if (!request || typeof request !== "object" || Object.keys(request).some(key => !["requestId", "expectedAttemptedAt", "acknowledgeUncertainAttempt"].includes(key))
    || request.acknowledgeUncertainAttempt !== true || typeof request.requestId !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(request.requestId)
    || typeof request.expectedAttemptedAt !== "string" || !Number.isFinite(Date.parse(request.expectedAttemptedAt))
    || new Date(request.expectedAttemptedAt).toISOString() !== request.expectedAttemptedAt)
    throw new Error("A single-use request ID and explicit acknowledgement of the exact uncertain attempt are required.");
  return request;
}

export function eligibleLoginRecovery(previous: LoginControl, request: LoginRecoveryRequest, now: number): boolean {
  return previous.blocked && previous.reason === "login-incomplete"
    && previous.attemptedAt === request.expectedAttemptedAt && now - Date.parse(request.expectedAttemptedAt) >= 30 * 60_000
    && (!previous.firstFailure || previous.firstFailure.outcome === "uncertain");
}

// Caller holds the same private browser lock used by ordinary collection. Never
// erase/rearm the control file. A reservation is permanent even if the process
// crashes before the first fill, so an uncertain request cannot be replayed.
export async function reserveLoginRecovery(insurer: Insurer, request: LoginRecoveryRequest, previous: LoginControl, now: number) {
  const directory = join(loginDirectory(insurer), "login-recovery");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, request.requestId.toLowerCase() + ".json");
  const audit = { version: 1, requestId: request.requestId.toLowerCase(), acknowledgedAt: new Date(now).toISOString(),
    originalControl: { blocked: previous.blocked, reason: previous.reason, attemptedAt: previous.attemptedAt,
      ...(previous.firstFailure ? { firstFailure: previous.firstFailure } : {}) },
    outcome: "reserved", phase: "checking-form", updatedAt: new Date(now).toISOString() };
  try { await writeFile(path, JSON.stringify(audit), { flag: "wx", mode: 0o600 }); }
  catch { throw new Error("Recovery request could not be reserved or has already been used. No credentials were filled."); }
  return async (outcome: "transmission-starting" | "authenticated" | "preflight" | "uncertain" | "human-required" | "rejection" | "credentials-unavailable", phase: string) => {
    await atomicJson(path, { ...audit, outcome, phase, updatedAt: new Date().toISOString() });
  };
}
