import { readFile } from "node:fs/promises";
import { atomicJson } from "./private-store.js";

export const policyRateUrl = "https://www.bankofcanada.ca/core-functions/monetary-policy/key-interest-rate/";
export type PolicyAnnouncement = { date: string; effectiveDate: string; rate: number; previousRate: number; change: number; sourceUrl: typeof policyRateUrl };
export type PolicyRateRead = { schema: 1; status: "ready" | "unavailable"; checkedAt: string; announcement?: PolicyAnnouncement; lastSuccessAt?: string };
const date = (s: string) => /^\d{4}-\d\d-\d\d$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const plain = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;|\u00a0/g, " ").replace(/\s+/g, " ").trim();
const torontoDate = (now: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
function validAnnouncement(a: PolicyAnnouncement): boolean {
  if (!a || !date(a.date) || !date(a.effectiveDate) || a.sourceUrl !== policyRateUrl || ![a.rate, a.previousRate, a.change].every(Number.isFinite) || a.rate < 0 || a.rate > 30 || a.previousRate < 0 || a.previousRate > 30 || Math.abs(a.change) > 5 || Math.abs(a.rate - a.previousRate - a.change) > .000001) return false;
  const next = new Date(a.date + "T12:00:00Z"); next.setUTCDate(next.getUTCDate() + 1);
  return a.effectiveDate === next.toISOString().slice(0, 10);
}
/** Read only the official Recent data table. Navigation, forecasts and other rates cannot become a decision. */
export function parsePolicyAnnouncement(html: string, asOf: string): PolicyAnnouncement {
  if (html.length > 1_000_000 || !date(asOf)) throw new Error("Official policy page invalid");
  const tables = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map(m => m[1]).filter(t => /Target\s*\(%\)/i.test(plain(t)) && /Change\s*\(%\)/i.test(plain(t)));
  if (tables.length !== 1) throw new Error("Official policy table changed");
  const rows = [...tables[0].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].filter(m => /<td\b/i.test(m[1])).map(m => [...m[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c => plain(c[1])));
  if (rows.length < 2 || rows.some(r => r.length !== 3)) throw new Error("Official policy rows changed");
  const dates = rows.map(r => {
    const m = /^([A-Za-z]+) (\d{1,2}), (\d{4})$/.exec(r[0]);
    if (!m || !months.includes(m[1])) throw new Error("Official policy date changed");
    const d = `${m[3]}-${String(months.indexOf(m[1]) + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
    if (!date(d)) throw new Error("Invalid official policy date"); return d;
  });
  if (dates.some((d, i) => i > 0 && d >= dates[i - 1])) throw new Error("Policy rows out of order");
  if (dates[0] > asOf) throw new Error("Future announcement is not evidence");
  const rate = (s: string) => { if (!/^\d+(?:\.\d+)?$/.test(s)) throw new Error("Invalid official target"); return Number(s); };
  const changeText = rows[0][2].replace(/&minus;|&#8722;|\u2212/g, "-");
  const unchanged = /^(?:---|—|–|&mdash;|&ndash;)$/.test(changeText);
  if (!unchanged && !/^[+-]?\d+(?:\.\d+)?$/.test(changeText)) throw new Error("Invalid official rate change");
  const effective = new Date(dates[0] + "T12:00:00Z"); effective.setUTCDate(effective.getUTCDate() + 1);
  const result: PolicyAnnouncement = { date: dates[0], effectiveDate: effective.toISOString().slice(0, 10), rate: rate(rows[0][1]), previousRate: rate(rows[1][1]), change: unchanged ? 0 : Number(changeText), sourceUrl: policyRateUrl };
  if (!validAnnouncement(result)) throw new Error("Official target/change mismatch"); return result;
}
/** The existing 15-minute scanner calls this hourly cache. No new task, key or household data in public requests. */
export class PolicyRateMonitor {
  private pending: Promise<PolicyRateRead> | null = null;
  constructor(private path: string, private request: typeof fetch = fetch) {}
  read(now = new Date()): Promise<PolicyRateRead> {
    if (this.pending) return this.pending;
    this.pending = this.collect(now).finally(() => { this.pending = null; }); return this.pending;
  }
  private async collect(now: Date): Promise<PolicyRateRead> {
    let prior: PolicyRateRead | undefined;
    try {
      prior = JSON.parse(await readFile(this.path, "utf8"));
      if (!prior || prior.schema !== 1 || !["ready", "unavailable"].includes(prior.status) || !Number.isFinite(Date.parse(prior.checkedAt)) || prior.announcement && !validAnnouncement(prior.announcement) || prior.status === "ready" && (!prior.announcement || prior.lastSuccessAt !== prior.checkedAt)) throw new Error("Policy state invalid; preserve it");
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    if (prior && Date.parse(prior.checkedAt) <= now.getTime() && now.getTime() - Date.parse(prior.checkedAt) < 3_600_000) return prior;
    let next: PolicyRateRead;
    try {
      const response = await this.request(policyRateUrl, { redirect: "error", headers: { accept: "text/html" }, signal: AbortSignal.timeout(12_000) });
      if (!response.ok) throw new Error("Official source unavailable");
      const html = await response.text(), announcement = parsePolicyAnnouncement(html, torontoDate(now));
      next = { schema: 1, status: "ready", checkedAt: now.toISOString(), lastSuccessAt: now.toISOString(), announcement };
    } catch { next = { schema: 1, status: "unavailable", checkedAt: now.toISOString(), ...(prior?.announcement ? { announcement: prior.announcement, lastSuccessAt: prior.lastSuccessAt } : {}) }; }
    await atomicJson(this.path, next); return next;
  }
}
