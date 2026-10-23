import type { Page } from "playwright";
import { isDesjardinsProfileSelection } from "./desjardins-profile-selection.js";
import { isDesjardinsDossierSelection } from "./desjardins-dossier-selection.js";

/** Paired, read-only inspection of the existing owned preparation context.
 * No cookies, tokens, query strings, password values, hidden fields or raw HTML.
 */
export async function claimPortalDiagnostic(page: Page) {
  const tabs = [];
  for (const candidate of page.context().pages().filter(p => !p.isClosed()).slice(0, 8)) {
    const url = new URL(candidate.url());
    const profile = isDesjardinsProfileSelection(candidate.url());
    const dossier = isDesjardinsDossierSelection(candidate.url());
    const portal = !url.username && !url.password && url.origin === "https://www.agea-gbim.dsf-dfs.com";
    const claim = portal && /^\/AGEA-GBIM\/Reclamation\/[A-Za-z_]+\.aspx$/i.test(url.pathname);
    const history = portal && /^\/AGEA-GBIM\/Rclmtn\/RclmtnTrt\/HistoriqueReclamation_ClaimHistory\.aspx$/i.test(url.pathname);
    const login = !url.username && !url.password && url.origin === "https://id.desjardins.com" && url.pathname === "/login";
    const kind = profile ? "profile" : dossier ? "dossier" : claim ? "claim" : history ? "history" : login ? "login" : "other";
    if (kind === "other") { tabs.push({ kind }); continue; }
    const passwordVisible = await candidate.locator('input[type="password"]').filter({ visible: true }).count() > 0;
    const challengeVisible = await candidate.locator('input[autocomplete="one-time-code"], iframe[src*="recaptcha"], iframe[src*="hcaptcha"]').filter({ visible: true }).count() > 0;
    const base = { kind, pathname: url.pathname, passwordVisible, challengeVisible };
    if (profile) {
      const tiles = await candidate.locator('dsd-form[aria-label="profil-select"] dsd-select-tile').evaluateAll(elements => elements.map(el => ({
        checkedProperty: (el as HTMLElement & { checked?: boolean }).checked === true,
        ariaChecked: el.getAttribute("aria-checked"), attributes: Array.from(el.attributes).map(a => a.name),
        radioChecked: !!el.querySelector('input[type="radio"]:checked'),
        shadowRadioChecked: !!el.shadowRoot?.querySelector('input[type="radio"]:checked')
      })));
      tabs.push({ ...base, tiles }); continue;
    }
    if (passwordVisible || challengeVisible || login) { tabs.push(base); continue; }
    const controls = await candidate.locator('input,select,textarea,button').evaluateAll(elements => elements.filter(el => el.getClientRects().length
      && !['hidden','password'].includes((el as HTMLInputElement).type)).slice(0, 100).map(el => ({
      tag: el.tagName, id: el.id, name: el.getAttribute('name'), type: el.getAttribute('type'),
      label: el.getAttribute('aria-label') || Array.from((el as HTMLInputElement).labels || []).map(l => l.textContent?.trim()).join(' '),
      caption: el.tagName === 'BUTTON' ? el.textContent?.trim() : ['button','submit'].includes((el as HTMLInputElement).type) ? (el as HTMLInputElement).value : undefined,
      checked: ['checkbox','radio'].includes((el as HTMLInputElement).type) ? (el as HTMLInputElement).checked : undefined,
      options: el instanceof HTMLSelectElement ? Array.from(el.options).map(o => ({ label: o.text, selected: o.selected, disabled: o.disabled })) : undefined
    })));
    const links = await candidate.locator('a[href]').evaluateAll(elements => elements.filter(el => el.getClientRects().length).flatMap(el => {
      const link = new URL((el as HTMLAnchorElement).href);
      return link.origin === location.origin && /^\/AGEA-GBIM\//.test(link.pathname)
        ? [{ label: el.textContent?.trim(), pathname: link.pathname }] : [];
    }).slice(0, 60));
    const headings = await candidate.locator('h1,h2,h3').allTextContents();
    tabs.push({ ...base, headings: headings.map(text => text.trim().slice(0, 300)), controls, links });
  }
  return { tabs, submitAllowed: false };
}
