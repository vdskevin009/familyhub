/** Exercise the actual compact filter disclosure instead of selecting hidden controls. */
export async function openFinanceFilters(page) {
    const dialog = page.getByRole("dialog", { name: "Filtres des finances", exact: true });
    if (!await dialog.isVisible()) await page.getByRole("button", { name: /^Filtres/ }).click();
    await dialog.waitFor(); return dialog;
}
export async function selectFinanceFilter(page, label, value) {
    const control = page.getByLabel(label, { exact: true });
    // Savings still exposes its period controls in its own native disclosure.
    const wasVisible = await control.isVisible();
    if (!wasVisible) await openFinanceFilters(page);
    await control.selectOption(value);
    if (!wasVisible) await page.getByRole("button", { name: "Voir les résultats", exact: true }).click();
}
export async function fillFinanceFilter(page, label, value) {
    const control = page.getByLabel(label, { exact: true }), wasVisible = await control.isVisible();
    if (!wasVisible) await openFinanceFilters(page);
    await control.fill(value);
    if (!wasVisible) await page.getByRole("button", { name: "Voir les résultats", exact: true }).click();
}

export async function openFinanceRegister(page) {
    const disclosure = page.locator(".finance-journey-disclosure").filter({ has: page.locator(".finance-register") }).first();
    await disclosure.waitFor({ state: "attached" });
    if (await disclosure.getAttribute("open") === null) await disclosure.locator(":scope > summary").click();
}
export async function openFinanceSection(page, label) {
    const summary = page.locator(".finance-journey-disclosure > summary").filter({ hasText: label }).first();
    if (await summary.count() && !await summary.evaluate(el => el.parentElement.open)) await summary.click();
}
