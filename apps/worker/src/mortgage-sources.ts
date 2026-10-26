import { localDate } from "./mortgage-model.js";

export type MortgageIndicator = {
  id: string; key: string; label: string; value: number | null; unit: "percent";
  observationDate: string | null; effectiveDate?: string | null; collectedAt: string; lastSuccessAt: string | null;
  status: "observed" | "failed" | "unavailable";
  reliability: "official" | "lender" | "external-forecast";
  sourceUrl: string; sourceTitle: string; conditions: string[]; error: string | null;
  lastKnown?: { value: number; observationDate: string; collectedAt: string };
};
export const mortgageOfficialSeries = [
  { key: "policy-rate", series: "V39079", label: "Taux directeur de la Banque du Canada", conditions: ["Cible du financement à un jour; ce n’est ni le prime d’un prêteur ni une offre hypothécaire."] },
  { key: "bond-3", series: "BD.CDN.3YR.DQ.YLD", label: "Obligation canadienne de référence · 3 ans", conditions: ["Rendement de clôture d’une obligation de référence; indicateur de pression, sans conversion mécanique en taux fixe."] },
  { key: "bond-5", series: "BD.CDN.5YR.DQ.YLD", label: "Obligation canadienne de référence · 5 ans", conditions: ["Rendement de clôture d’une obligation de référence; indicateur de pression, sans conversion mécanique en taux fixe."] },
  { key: "prime-benchmark", series: "V80691311", label: "Prime bancaire de référence", conditions: ["Série hebdomadaire nationale; ne remplace pas le prime hypothécaire propre au prêteur du devis."] },
  { key: "cpi-yearly", series: "STATIC_TOTALCPICHANGE", label: "Inflation annuelle · IPC total", conditions: ["Variation sur douze mois non désaisonnalisée; la date Valet désigne le début du mois de référence, pas la date de publication. Indicateur de contexte, sans prédiction de décision."] },
] as const;
const validDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + "T12:00:00Z")) && new Date(value + "T12:00:00Z").toISOString().slice(0, 10) === value;
const timestamp = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value));
const text = (value: unknown, max = 2000): value is string => typeof value === "string" && !!value.trim() && value.length <= max;
export function validateMortgageIndicator(value: unknown): MortgageIndicator {
  const i = value as MortgageIndicator;
  const fail = () => { throw new Error("Invalid mortgage indicator; existing source history preserved"); };
  if (!i || !text(i.id, 200) || !text(i.key, 100) || !text(i.label) || !timestamp(i.collectedAt) || i.unit !== "percent" || !["observed", "failed", "unavailable"].includes(i.status) || !["official", "lender", "external-forecast"].includes(i.reliability) || !text(i.sourceTitle) || !Array.isArray(i.conditions) || !i.conditions.length || i.conditions.length > 20 || !i.conditions.every(c => text(c))) fail();
  let url: URL; try { url = new URL(i.sourceUrl); } catch { return fail() as never; }
  if (url!.protocol !== "https:" || url!.username || url!.password || i.reliability === "official" && !/(^|\.)(bankofcanada\.ca|banqueducanada\.ca|statcan\.gc\.ca)$/.test(url!.hostname)) fail();
  if (i.status === "observed") {
    if (typeof i.value !== "number" || !Number.isFinite(i.value) || i.value < -100 || i.value > 100 || !validDate(i.observationDate) || i.observationDate > localDate(i.collectedAt) || i.lastSuccessAt !== i.collectedAt || i.error !== null) fail();
  } else if (i.value !== null || i.observationDate !== null || !text(i.error) || i.lastSuccessAt !== null && !timestamp(i.lastSuccessAt)) fail();
  if (i.lastKnown && (!Number.isFinite(i.lastKnown.value) || !validDate(i.lastKnown.observationDate) || !timestamp(i.lastKnown.collectedAt) || i.lastKnown.collectedAt !== i.lastSuccessAt || Date.parse(i.lastKnown.collectedAt) > Date.parse(i.collectedAt))) fail();
  if (i.effectiveDate !== undefined && i.effectiveDate !== null && (!validDate(i.effectiveDate) || i.effectiveDate > localDate(i.collectedAt))) fail();
  return structuredClone(i);
}
export function mortgageIndicatorFresh(i: MortgageIndicator, now: Date, maxAgeDays = 7): boolean {
  if (i.status !== "observed" || !i.observationDate) return false;
  const age = (Date.parse(localDate(now) + "T12:00:00Z") - Date.parse(i.observationDate + "T12:00:00Z")) / 86_400_000;
  return age >= 0 && age <= maxAgeDays && Date.parse(i.collectedAt) <= now.getTime() && now.getTime() - Date.parse(i.collectedAt) <= 2 * 86_400_000;
}
/** Parse only the named official series, never the first numeric field or blank-as-zero. */
export function parseValetObservation(payload: unknown, series: string, asOf: string): { value: number; observationDate: string } | null {
  const body = payload as { observations?: Record<string, unknown>[]; seriesDetail?: Record<string, unknown> };
  if (!body || !body.seriesDetail || !Object.hasOwn(body.seriesDetail, series) || !Array.isArray(body.observations) || body.observations.length > 10000) throw new Error("Official series response invalid");
  const rows = body.observations.filter(row => validDate(row.d) && row.d <= asOf).sort((a, b) => String(b.d).localeCompare(String(a.d)));
  for (const row of rows) {
    const cell = row[series] as { v?: unknown } | undefined, raw = cell?.v;
    if (raw === undefined || raw === null || raw === "") continue;
    if (typeof raw !== "string" || !/^-?\d+(?:\.\d+)?$/.test(raw)) throw new Error("Official series value invalid");
    const value = Number(raw); if (!Number.isFinite(value) || value < -100 || value > 100) throw new Error("Official series value invalid");
    return { value, observationDate: row.d as string };
  }
  return null;
}
/** Public official requests carry no household fields. Failure never refreshes last successful evidence. */
export async function collectMortgageIndicators(previous: MortgageIndicator[] = [], now = new Date(), request: typeof fetch = fetch): Promise<MortgageIndicator[]> {
  const collectedAt = now.toISOString(), today = localDate(now);
  const official = await Promise.all(mortgageOfficialSeries.map(async spec => {
    const sourceUrl = `https://www.bankofcanada.ca/valet/observations/${spec.series}/json?recent=10`;
    const base = { id: `${spec.key}:${collectedAt}`, key: spec.key, label: spec.label, unit: "percent" as const, collectedAt, reliability: "official" as const, sourceUrl, sourceTitle: "Banque du Canada · Valet", conditions: [...spec.conditions] };
    try {
      const response = await request(sourceUrl, { redirect: "error", headers: { accept: "application/json" }, signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw new Error("Official source unavailable");
      const raw = await response.text(); if (raw.length > 250000) throw new Error("Official response too large");
      const result = parseValetObservation(JSON.parse(raw), spec.series, today);
      if (!result) throw new Error("Official source has no dated observation");
      return validateMortgageIndicator({ ...base, ...result, status: "observed", lastSuccessAt: collectedAt, error: null });
    } catch {
      const prior = previous.filter(i => i.key === spec.key && Date.parse(i.collectedAt) <= now.getTime()).sort((a, b) => b.collectedAt.localeCompare(a.collectedAt))[0];
      const lastKnown = prior?.status === "observed" && prior.value !== null && prior.observationDate ? { value: prior.value, observationDate: prior.observationDate, collectedAt: prior.collectedAt } : prior?.lastKnown;
      return validateMortgageIndicator({ ...base, value: null, observationDate: null, status: "failed", lastSuccessAt: lastKnown?.collectedAt ?? null, error: "Source officielle indisponible; aucune nouvelle valeur confirmée.", ...(lastKnown ? { lastKnown } : {}) });
    }
  }));
  return [...official, ...await collectMortgageTdPrime(previous, now, request)];
}


export type MortgageContextSource = {
  key: "policy-calendar" | "employment" | "economic-forecast";
  label: string; status: "observed" | "failed" | "unavailable"; collectedAt: string | null;
  sourceUrl: string; sourceTitle: string; date: string | null; detail: string;
  lastKnown?: { date: string; collectedAt: string };
};
export function unavailableMortgageContext(): MortgageContextSource[] {
  return [
    { key: "policy-calendar", label: "Prochaine décision de la Banque du Canada", status: "unavailable", collectedAt: null, sourceUrl: "https://www.bankofcanada.ca/core-functions/monetary-policy/key-interest-rate/", sourceTitle: "Banque du Canada · calendrier", date: null, detail: "Calendrier officiel non collecté; aucune date supposée." },
    { key: "employment", label: "Emploi et chômage", status: "unavailable", collectedAt: null, sourceUrl: "https://www.statcan.gc.ca/en/subjects-start/labour_", sourceTitle: "Statistique Canada · Enquête sur la population active", date: null, detail: "Publication non collectée automatiquement. Aucun chiffre d’emploi ou de chômage supposé." },
    { key: "economic-forecast", label: "Prévisions économiques externes", status: "unavailable", collectedAt: null, sourceUrl: "https://www.bankofcanada.ca/publications/mpr/", sourceTitle: "Banque du Canada · Rapport sur la politique monétaire", date: null, detail: "Prévisions non extraites; les simulations financières ne sont pas des prévisions économiques." },
  ];
}
export function validateMortgageContext(value: unknown): MortgageContextSource {
  const s = value as MortgageContextSource;
  if (!s || !["policy-calendar", "employment", "economic-forecast"].includes(s.key) || !text(s.label) || !["observed", "failed", "unavailable"].includes(s.status) || !(s.collectedAt === null || timestamp(s.collectedAt)) || !text(s.sourceTitle) || !text(s.detail) || !(s.date === null || validDate(s.date)) || s.status === "observed" && (!s.date || !s.collectedAt) || s.status !== "observed" && s.date !== null || s.status === "unavailable" && s.collectedAt !== null) throw new Error("Invalid mortgage context source");
  const url = new URL(s.sourceUrl); if (url.protocol !== "https:" || url.username || url.password || !/(^|\.)(bankofcanada\.ca|statcan\.gc\.ca)$/.test(url.hostname)) throw new Error("Invalid official context source");
  if (s.lastKnown && (!validDate(s.lastKnown.date) || !timestamp(s.lastKnown.collectedAt))) throw new Error("Invalid prior mortgage context");
  return structuredClone(s);
}
/** Only the dated official calendar tables qualify, never arbitrary dates elsewhere in the page. */
export function parsePolicyCalendar(html: string, today: string): string | null {
  if (!validDate(today) || html.length > 1000000) throw new Error("Invalid policy calendar");
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const dates: string[] = [];
  for (const table of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    const caption = /<caption\b[^>]*>\s*Schedule for (\d{4})\s*<\/caption>/i.exec(table[1]); if (!caption) continue;
    const year = Number(caption[1]); if (year < Number(today.slice(0, 4)) || year > Number(today.slice(0, 4)) + 1) continue;
    const tableDates: string[] = [];
    for (const row of table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)]; if (!cells.length) continue;
      if (cells.length !== 2 || !/Interest rate announcement/i.test(cells[1][1].replace(/<[^>]*>/g, ""))) throw new Error("Policy calendar layout changed");
      const monthDay = cells[0][1].replace(/&nbsp;|&#160;|\u00a0/g, " ").trim(), parsed = /^([A-Za-z]+) +(\d{1,2})$/.exec(monthDay);
      if (!parsed || !months.includes(parsed[1])) throw new Error("Policy calendar date changed");
      const date = `${year}-${String(months.indexOf(parsed[1]) + 1).padStart(2, "0")}-${parsed[2].padStart(2, "0")}`;
      if (!validDate(date)) throw new Error("Invalid scheduled date"); tableDates.push(date);
    }
    if (tableDates.length !== 8 || new Set(tableDates).size !== 8) throw new Error("Incomplete policy calendar");
    dates.push(...tableDates);
  }
  return dates.filter(date => date >= today).sort()[0] ?? null;
}
export async function collectMortgageContext(previous: MortgageContextSource[] = [], now = new Date(), request: typeof fetch = fetch): Promise<MortgageContextSource[]> {
  const collectedAt = now.toISOString(), today = localDate(now);
  const fetchText = async (url: string) => { const response = await request(url, { redirect: "error", signal: AbortSignal.timeout(12000) }); if (!response.ok) throw new Error("Official context unavailable"); const body = await response.text(); if (body.length > 1500000) throw new Error("Official context too large"); return body; };
  return Promise.all(unavailableMortgageContext().map(async source => {
    try {
      const html = await fetchText(source.sourceUrl);
      if (source.key === "policy-calendar") {
        const date = parsePolicyCalendar(html, today); if (!date) throw new Error("Future decision not verified");
        return validateMortgageContext({ ...source, status: "observed", collectedAt, date, detail: "Date lue dans le calendrier officiel. Elle ne préjuge ni de la décision ni du prime du prêteur." });
      }
      if (source.key === "employment") {
        const sourceUrl = parseLabourReleaseLink(html, today); if (!sourceUrl) throw new Error("Current labour publication unavailable");
        const release = parseLabourRelease(await fetchText(sourceUrl), sourceUrl, today);
        return validateMortgageContext({ ...source, status: "observed", collectedAt, sourceUrl, ...release });
      }
      const forecast = parseEconomicForecast(html, today); if (!forecast) throw new Error("Dated external forecast unavailable");
      return validateMortgageContext({ ...source, status: "observed", collectedAt, ...forecast });
    } catch {
      const old = previous.filter(s => s.key === source.key).sort((a, b) => (b.collectedAt ?? "").localeCompare(a.collectedAt ?? ""))[0];
      const lastKnown = old?.status === "observed" && old.date && old.collectedAt ? { date: old.date, collectedAt: old.collectedAt } : old?.lastKnown;
      return validateMortgageContext({ ...source, status: "failed", collectedAt, detail: "Source officielle indisponible ou structure modifiée; aucune nouvelle information confirmée.", ...(lastKnown ? { lastKnown } : {}) });
    }
  }));
}
function readableText(value: string): string {
  return value.replace(/<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;|\u00a0/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/\s+/g, " ").trim();
}
export function parseLabourReleaseLink(html: string, today: string): string | null {
  if (html.length > 1500000 || !validDate(today)) throw new Error("Invalid labour index");
  const links = [...html.matchAll(/<a\b[^>]*href=["'](https:\/\/www150\.statcan\.gc\.ca\/n1\/daily-quotidien\/(\d{6})\/dq\2[a-z]-eng\.htm)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .filter(m => /^Labour Force Survey, [A-Za-z]+ \d{4}$/.test(readableText(m[3])))
    .map(m => ({ url: m[1], date: `20${m[2].slice(0, 2)}-${m[2].slice(2, 4)}-${m[2].slice(4, 6)}` }))
    .filter(link => validDate(link.date) && link.date <= today).sort((a, b) => b.date.localeCompare(a.date));
  return links[0]?.url ?? null;
}
function meta(html: string, name: string): string | null {
  const tags = [...html.matchAll(/<meta\b[^>]*>/gi)];
  const matches = tags.filter(tag => new RegExp(`\\bname=["']${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`, "i").test(tag[0]));
  if (matches.length !== 1) return null;
  return /\bcontent=["']([^"']*)["']/i.exec(matches[0][0])?.[1] ?? null;
}
export function parseLabourRelease(html: string, sourceUrl: string, today: string): { date: string; detail: string } {
  if (html.length > 1500000 || !/<title>[^<]*Labour Force Survey,/i.test(html)) throw new Error("Labour release identity changed");
  const date = meta(html, "dcterms.issued"), description = meta(html, "description");
  const identity = /^https:\/\/www150\.statcan\.gc\.ca\/n1\/daily-quotidien\/(\d{6})\/dq\1[a-z]-eng\.htm$/.exec(sourceUrl);
  if (!identity || !validDate(date) || date > today || date.replaceAll("-", "").slice(2) !== identity[1] || !description || !/employment/i.test(description) || !/unemployment/i.test(description)) throw new Error("Labour release date or content not verified");
  const excerpt = readableText(description); if (!excerpt || excerpt.length > 800) throw new Error("Labour release summary changed");
  return { date, detail: `Publication officielle du ${date}. Extrait (anglais) : « ${excerpt} » Le marché du travail éclaire le contexte; il ne prédit pas le taux hypothécaire.` };
}
export function parseEconomicForecast(html: string, today: string): { date: string; detail: string; sourceUrl: string } | null {
  if (html.length > 1500000 || !validDate(today)) throw new Error("Invalid monetary policy index");
  const candidates: { date: string; detail: string; sourceUrl: string }[] = [];
  for (const article of html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)) {
    const link = /<a\b[^>]*href=["'](https:\/\/www\.bankofcanada\.ca\/publications\/mpr\/mpr-(\d{4}-\d{2}-\d{2})\/)["'][^>]*data-content-type=["']Monetary Policy Report["'][^>]*>/i.exec(article[1]);
    const excerpt = /<div\b[^>]*class=["']media-excerpt["'][^>]*>([\s\S]*?)<\/div>/i.exec(article[1]);
    if (!link || !excerpt || !validDate(link[2]) || link[2] > today) continue;
    const detail = readableText(excerpt[1]); if (!detail || detail.length > 800 || !/expected|projected|forecast/i.test(detail)) continue;
    candidates.push({ date: link[2], sourceUrl: link[1], detail: `Prévision externe publiée le ${link[2]}. Extrait officiel (anglais) : « ${detail} » Aucune probabilité ni garantie de taux attribuée.` });
  }
  return candidates.sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
}



export function parseTdGeneralPrime(html: string): { value: number; effectiveDate: string } {
  if (html.length > 1000000) throw new Error("TD rate page too large");
  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].filter(row => [...row[1].matchAll(/<td\b[^>]*>/gi)].length === 2 && [...row[1].matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].some(cell => readableText(cell[1]) === "TD Prime Rate"));
  if (rows.length !== 1) throw new Error("TD prime label missing or ambiguous");
  const cells = [...rows[0][1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(cell => readableText(cell[1]));
  if (cells.length !== 2 || !/^\d+(?:\.\d+)?%$/.test(cells[0])) throw new Error("TD prime row changed");
  const day = Date.parse(cells[1] + " 12:00:00 UTC"); if (!Number.isFinite(day)) throw new Error("TD prime effective date unknown");
  const value = Number(cells[0].replace("%", "")); if (value < 0 || value > 30) throw new Error("TD prime rate invalid");
  return { value, effectiveDate: new Date(day).toISOString().slice(0, 10) };
}
export function parseTdMortgagePrime(value: unknown): number {
  const body = value as Record<string, { highRatio?: unknown[]; nonHighRatio?: unknown[] }>;
  const variants = body?.MTGV060C;
  if (!variants || !Array.isArray(variants.highRatio) || !Array.isArray(variants.nonHighRatio) || variants.highRatio.length !== 5 || variants.nonHighRatio.length !== 5) throw new Error("TD mortgage public schema changed");
  // Public TD rendering maps index 0 to PostedRate for MTGV060C, the explicitly labelled mortgage prime.
  const high = variants.highRatio[0], regular = variants.nonHighRatio[0];
  if (typeof high !== "string" || typeof regular !== "string" || !/^\d+(?:\.\d+)?$/.test(high) || !/^\d+(?:\.\d+)?$/.test(regular) || high !== regular || Number(regular) < 0 || Number(regular) > 30) throw new Error("TD mortgage prime inconsistent");
  return Number(regular);
}
export async function collectMortgageTdPrime(previous: MortgageIndicator[] = [], now = new Date(), request: typeof fetch = fetch): Promise<MortgageIndicator[]> {
  const collectedAt = now.toISOString(), observationDate = localDate(now);
  return Promise.all([
    { key: "lender-prime:td-general", label: "TD · prime général", sourceUrl: "https://www.td.com/ca/en/personal-banking/products/todays-rates-and-prime", conditions: ["Prime général publié par TD, distinct du prime hypothécaire TD. Aucune correspondance automatique avec un devis."] },
    { key: "lender-prime:td-mortgage", label: "TD · prime hypothécaire", sourceUrl: "https://www.td.com/ca/en/personal-banking/products/mortgages/mortgage-rates", conditions: ["Prime hypothécaire TD affiché par le produit public MTGV060C; distinct du prime général TD. Rabais contractuel et admissibilité propres au devis à confirmer.", "Date d’entrée en vigueur non fournie par le flux; observation de la page actuelle à la date de collecte."] },
  ].map(async spec => {
    const base = { ...spec, id: `${spec.key}:${collectedAt}`, unit: "percent" as const, collectedAt, reliability: "lender" as const, sourceTitle: "TD Canada Trust · taux publics" };
    try {
      const response = await request(spec.sourceUrl, { redirect: "error", signal: AbortSignal.timeout(12000) }); if (!response.ok) throw new Error("TD page unavailable");
      const html = await response.text(); if (html.length > 1000000) throw new Error("TD page too large");
      let value: number, effectiveDate: string | null = null;
      if (spec.key === "lender-prime:td-general") ({ value, effectiveDate } = parseTdGeneralPrime(html));
      else {
        if (!html.includes('data-product-key="MTGV060C"') || !html.includes('data-value="PostedRate"') || !html.includes("TD Mortgage Prime Rate") || !html.includes("psservice.td.com")) throw new Error("TD mortgage rendering changed");
        // This is the same public read request the TD page performs; only generic product parameters, no borrower data.
        const rates = await request("https://psservice.td.com/ca/en/carate/getRates", { method: "POST", redirect: "error", headers: { "content-type": "application/json" }, body: JSON.stringify({ errorText: "Unable to get the rate", ratesType: "resl" }), signal: AbortSignal.timeout(12000) });
        if (!rates.ok) throw new Error("TD public rates unavailable"); const raw = await rates.text(); if (raw.length > 100000) throw new Error("TD public rates too large"); value = parseTdMortgagePrime(JSON.parse(raw));
      }
      return validateMortgageIndicator({ ...base, value, effectiveDate, observationDate, status: "observed", lastSuccessAt: collectedAt, error: null });
    } catch {
      const old = previous.filter(i => i.key === spec.key).sort((a, b) => b.collectedAt.localeCompare(a.collectedAt))[0];
      const lastKnown = old?.status === "observed" && old.value !== null && old.observationDate ? { value: old.value, observationDate: old.observationDate, collectedAt: old.collectedAt } : old?.lastKnown;
      return validateMortgageIndicator({ ...base, value: null, effectiveDate: null, observationDate: null, status: "failed", lastSuccessAt: lastKnown?.collectedAt ?? null, error: "Taux TD public indisponible ou structure modifiée; aucun prime de référence substitué.", ...(lastKnown ? { lastKnown } : {}) });
    }
  }));
}
