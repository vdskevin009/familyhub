import type { Page } from "playwright";
import { join } from "node:path";
import { dataDirectory, loadPrivate } from "./private-store.js";
import { continueDesjardinsProfileSelection } from "./desjardins-profile-selection.js";
import { continueDesjardinsDossierSelection } from "./desjardins-dossier-selection.js";

/** Shared ordinary post-password steps for collection and preparation. Caller holds the portal lock. */
export async function continueDesjardinsSignIn(page: Page): Promise<void> {
  await continueDesjardinsProfileSelection(page, async () => {
    try {
      const preference = await loadPrivate<{ version: number; profile: string }>(join(dataDirectory, "desjardins", "profile-preference.dpapi"));
      if (preference.version !== 1 || typeof preference.profile !== "string" || !preference.profile.trim()) throw new Error();
      return preference.profile;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw new Error("Saved Desjardins profile preference cannot be unlocked.");
    }
  });
  await continueDesjardinsDossierSelection(page);
}
