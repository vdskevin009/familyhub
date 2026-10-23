import { MortgageStore } from "./mortgage-store.js";
import { localDate, snapshotOn } from "./mortgage-model.js";
import { compareMortgage, latestDecisionProfile, decisionTermsFor } from "./mortgage-decision.js";
import { buildMortgageDailyReport, mortgageEvidenceFingerprint, type MortgageDailyReport } from "./mortgage-daily.js";
import { collectMortgageIndicators, collectMortgageContext } from "./mortgage-sources.js";

/** Extends the existing collection. Forced input changes are drained after an active run. */
export class MortgageDailyRunner {
  private pending: Promise<MortgageDailyReport | null> | null = null;
  private activeDate: string | null = null;
  private queued: { now: Date; force: boolean } | null = null;
  constructor(private store: MortgageStore, private collect = collectMortgageIndicators, private collectContext = collectMortgageContext) {}
  run(now = new Date(), force = false): Promise<MortgageDailyReport | null> {
    if (!Number.isFinite(now.getTime())) return Promise.reject(Error("Invalid mortgage report date"));
    if (this.pending) {
      if (force || localDate(now) !== this.activeDate) {
        const latest = !this.queued || now >= this.queued.now ? now : this.queued.now;
        this.queued = { now: latest, force: force || this.queued?.force === true };
      }
      return this.pending;
    }
    this.activeDate = localDate(now);
    this.pending = this.drain({ now, force }).finally(() => { this.pending = null; this.activeDate = null; this.queued = null; });
    return this.pending;
  }
  private async drain(first: { now: Date; force: boolean }): Promise<MortgageDailyReport | null> {
    let request: typeof first | null = first, report: MortgageDailyReport | null = null;
    while (request) {
      this.activeDate = localDate(request.now);
      report = await this.execute(request.now);
      request = this.queued; this.queued = null;
    }
    return report;
  }
  private async execute(now: Date): Promise<MortgageDailyReport | null> {
    const state = await this.store.read(), today = localDate(now);
    // Starting an unused worker does not enroll a household. Existing source evidence is required.
    if (!state.snapshots.length && !state.quotes.length && !state.offers?.length) return null;
    const previous = [...state.reports ?? []].filter(r => Date.parse(r.generatedAt) <= now.getTime()).sort((a,b) => b.generatedAt.localeCompare(a.generatedAt));
    const visibleSnapshots = state.snapshots.filter(s => Date.parse(s.collectedAt) <= now.getTime());
    const current = snapshotOn({ ...state, snapshots: visibleSnapshots }, today), last = previous[0];
    // Immutable IDs represent exact contents, including evidence received today with an older source date.
    const inputFingerprint = mortgageEvidenceFingerprint({
      snapshots: visibleSnapshots.map(s => s.id).sort(), baseline: state.baselineSnapshotId,
      offers: [...state.quotes,...state.offers ?? []].map(q => q.id).sort(),
      profiles: (state.profiles ?? []).map(p => p.id).sort(), terms: (state.terms ?? []).map(t => t.id).sort(),
      settings: (state.settings ?? []).map(s => s.id).sort(), contacts: (state.contacts ?? []).map(c => c.id).sort()
    });
    if (last?.localDate === today && last.snapshotId === (current?.id ?? null) && last.inputFingerprint === inputFingerprint) return last;
    // Private corrections reuse today's actual official collection; they do not start redundant network jobs.
    const [indicators, contextSources] = last?.localDate === today
      ? [last.indicators, last.contextSources]
      : await Promise.all([this.collect(previous.flatMap(r => r.indicators), now), this.collectContext(previous.flatMap(r => r.contextSources), now)]);
    const profile = latestDecisionProfile(state.profiles ?? []) ?? null;
    const settings = [...state.settings ?? []].sort((a,b) => b.recordedAt.localeCompare(a.recordedAt) || b.id.localeCompare(a.id))[0];
    const quotes = [...state.quotes, ...state.offers ?? []], superseded = new Set(quotes.map(q => q.supersedes).filter(Boolean));
    const comparisons = quotes.filter(q => q.status !== "historical" && !superseded.has(q.id) && q.receivedDate <= today).map(q => {
      const terms = decisionTermsFor(state.terms ?? [], q.id) ?? null;
      const c = compareMortgage(profile, q, terms, today, undefined, { maximumQuoteAgeDays: settings?.maximumQuoteAgeDays });
      return { offerId: c.offerId, status: c.status, confirmed: c.confirmed, netGain: c.netGain, breakEvenMonths: c.breakEvenMonths, uncertainties: c.uncertainties, nextAction: c.nextAction, validUntil: terms?.validUntil ?? null, endDate: c.endDate, monthlyPaymentChange: c.monthlyPaymentChange };
    });
    const report = buildMortgageDailyReport({ state, now, previous, settings, indicators, contextSources, comparisons, inputFingerprint });
    const existing = previous.find(r => r.id === report.id); if (existing) return existing;
    await this.store.ingest("report", report);
    return (await this.store.read()).reports!.find(r => r.id === report.id)!;
  }
  /** Existing worker loop catches missed daily work after 09:30 Vancouver. No retrospective backfill. */
  due(now = new Date()): boolean {
    const time = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Vancouver", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
    return time >= "09:30";
  }
}
