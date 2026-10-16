import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dataDirectory } from "./private-store.js";
import type { ClaimPreparation } from "./claim-preparation.js";

/** Reserve before any file transmission. An uncertain upload survives browser/worker restarts. */
export async function reserveClaimUpload(dossier: ClaimPreparation, hash: string) {
  const key = createHash("sha256").update(JSON.stringify([dossier.insurer, dossier.expenseId, hash])).digest("hex");
  const directory = join(dataDirectory, "claim-upload-attempts");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try { await writeFile(join(directory, `${key}.json`), JSON.stringify({ version: 1, attemptedAt: new Date().toISOString() }), { flag: "wx", mode: 0o600 }); }
  catch { throw new Error("This receipt upload was already attempted or its guard could not be saved. Check the insurer record; do not repeat the upload."); }
}

/** Explicit owner-authorized recovery keeps the original reservation intact. */
export async function reserveClaimUploadRetry(dossier: ClaimPreparation, hash: string, input: { confirmed?: unknown; scope?: unknown }) {
  if (input.confirmed !== true || typeof input.scope !== "string" || !/^[a-f0-9-]{36}$/.test(input.scope)) throw new Error("Explicitly confirm this one-time receipt recovery.");
  const originalKey = createHash("sha256").update(JSON.stringify([dossier.insurer, dossier.expenseId, hash])).digest("hex");
  const directory = join(dataDirectory, "claim-upload-attempts");
  const original = JSON.parse(await readFile(join(directory, originalKey + ".json"), "utf8"));
  if (original.version !== 1 || !Number.isFinite(Date.parse(original.attemptedAt))) throw new Error("The earlier upload record needs local review.");
  const key = createHash("sha256").update(JSON.stringify([originalKey, "explicit-retry-v1", input.scope])).digest("hex");
  try { await writeFile(join(directory, key + ".json"), JSON.stringify({ version: 1, attemptedAt: new Date().toISOString(), explicitRetryOf: originalKey, preparationScope: input.scope }), { flag: "wx", mode: 0o600 }); }
  catch { throw new Error("This recovery upload was already attempted or could not be reserved. Do not repeat it."); }
}