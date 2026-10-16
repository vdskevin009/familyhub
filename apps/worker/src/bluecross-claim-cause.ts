import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "playwright";
import { atomicJson, dataDirectory } from "./private-store.js";
import type { ClaimPreparation } from "./claim-preparation.js";

type Answer = { version: 1; value: "unrelated" | null; revision: number; confirmedAt: string | null };
const path = join(dataDirectory, "bluecross-claim-cause-answer.json");
export async function blueCrossClaimCauseAnswer(): Promise<Answer> {
  let raw: string;
  try { raw = await readFile(path, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, value: null, revision: 0, confirmedAt: null }; throw error; }
  if (raw.length > 2000) throw new Error("Saved claim cause needs local review.");
  const answer = JSON.parse(raw) as Answer;
  if (answer.version !== 1 || !["unrelated", null].includes(answer.value) || !Number.isSafeInteger(answer.revision) || answer.revision < 1
    || typeof answer.confirmedAt !== "string" || !Number.isFinite(Date.parse(answer.confirmedAt))) throw new Error("Saved claim cause needs local review.");
  return answer;
}
let pending = Promise.resolve();
export function confirmBlueCrossClaimCause(input: { confirmed?: unknown; allInvoices?: unknown; expectedRevision?: unknown; value?: unknown }) {
  const action = pending.then(async () => {
    if (input.confirmed !== true || input.allInvoices !== true || (input.value !== "unrelated" && input.value !== null)) throw new Error("Explicitly confirm the Blue Cross claim-cause default and its scope.");
    const before = await blueCrossClaimCauseAnswer();
    if (input.expectedRevision !== before.revision) throw new Error("The claim-cause answer changed. Read it again.");
    const answer: Answer = { version: 1, value: input.value as Answer["value"], revision: before.revision + 1, confirmedAt: new Date().toISOString() };
    await atomicJson(path, answer); return answer;
  });
  pending = action.then(() => {}, () => {}); return action;
}
const causes = [
  ["YesICBC", "I am claiming services related to an ICBC or other auto insurance case."],
  ["YesWCB", "I am claiming services related to a WorkSafe case (WCB)."],
  ["YesAccident", "I am claiming services related to an accident."],
  ["YesEmergency", "I am claiming services related to a medical emergency that occurred while travelling outside of Canada."],
  ["No", "The service or product provided is not related in any way to a motor vehicle incident, workplace incident, or any other accident where ICBC, WorkSafe BC, or any other liable third party may become involved, and is not related to a medical emergency while travelling outside of Canada."]
] as const;
const exactLabel = (text: string) => new RegExp("^" + text.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+") + "$");
export async function isBlueCrossClaimCausePage(page: Page) {
  const url = new URL(page.url());
  if (url.origin !== "https://service.pac.bluecross.ca" || url.pathname !== "/ACESWeb/Pages/Claims/eClaim.aspx"
    || await page.locator('input[type="password"], input[id$="_txtAmount"], input[id$="_cmbCoveredLife_Input"]').filter({ visible: true }).count()) return false;
  if (await page.getByText("Please select one of the following:", { exact: true }).filter({ visible: true }).count() !== 1) return false;
  const body = await page.locator("body").innerText();
  if (/review (?:your )?claim|claim summary|your claim has been (?:processed|submitted)|I confirm all the information above/i.test(body)) return false;
  for (const [suffix, label] of causes) {
    const control = page.locator('input[type="radio"][id$="_ucClaimCause_optClaimCause' + suffix + '"]').filter({ visible: true });
    if (await control.count() !== 1 || await control.and(page.getByRole("radio", { name: exactLabel(label) })).count() !== 1) return false;
  }
  return await page.locator('input[type="radio"][id*="_ucClaimCause_"]').filter({ visible: true }).count() === causes.length;
}
/** Only an explicitly saved owner answer can advance this observed initial screen. */
export async function openBlueCrossClaimCause(page: Page, dossier: ClaimPreparation, beforeClick: () => void = () => {}) {
  if (dossier.blocked || dossier.insurer !== "blue-cross" || !await isBlueCrossClaimCausePage(page) || (await blueCrossClaimCauseAnswer()).value !== "unrelated") return false;
  const url = page.url();
  const others = page.locator('input[type="radio"][id*="_ucClaimCause_"]:not([id$="_optClaimCauseNo"])').filter({ visible: true });
  for (const other of await others.all()) if (await other.isChecked()) return false;
  const entry = page.locator('input[type="radio"][id$="_ucClaimCause_optClaimCauseNo"]').filter({ visible: true });
  if (!await entry.isEnabled()) return false;
  beforeClick();
  await entry.check({ timeout: 7000 });
  const next = page.locator('input[id$="_StartNavigationTemplateContainerID_StartNextButton"], button[id$="_StartNavigationTemplateContainerID_StartNextButton"]').filter({ visible: true });
  await next.waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
  if (page.url() !== url || !await isBlueCrossClaimCausePage(page) || !await entry.isChecked()
    || await next.count() !== 1 || !await next.isEnabled() || await next.and(page.getByRole("button", { name: /^Next$/i })).count() !== 1
    || await page.getByRole("button", { name: /^Next$/i }).filter({ visible: true }).count() !== 1) return false;
  for (const other of await others.all()) if (await other.isChecked()) return false;
  await next.click({ noWaitAfter: true, timeout: 7000 });
  await page.locator('input[id$="_txtAmount"], input[id$="_cmbCoveredLife_Input"]').filter({ visible: true }).first().waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
  return true;
}