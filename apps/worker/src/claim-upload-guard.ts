import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
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
