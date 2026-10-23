import type { Page } from "playwright";
import { join } from "node:path";
import { atomicJson, dataDirectory, loadPrivate } from "./private-store.js";
import { continueDesjardinsProfileSelection, isDesjardinsProfileSelection } from "./desjardins-profile-selection.js";
import { continueDesjardinsDossierSelection, isDesjardinsDossierSelection } from "./desjardins-dossier-selection.js";

/** Shared ordinary post-password steps for collection and preparation. Caller holds the portal lock. */
export async function continueDesjardinsSignIn(page: Page): Promise<Page> {
  // An ordinary sign-in can open its selection in another tab. Restrict this
  // continuation to a unique known selection in the same owned context.
  const selections = page.context().pages().filter(candidate => !candidate.isClosed()
    && (isDesjardinsProfileSelection(candidate.url()) || isDesjardinsDossierSelection(candidate.url())));
  await atomicJson(join(dataDirectory, "desjardins", "signin-tab-diagnostic.json"), {
    version: 1, observedAt: new Date().toISOString(), pages: page.context().pages().length,
    selectionPages: selections.length, alternateSelection: selections.length === 1 && selections[0] !== page
  }).catch(() => {});
  if (selections.length > 1) return page;
  if (selections.length === 1) page = selections[0];
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
  return page;
}
