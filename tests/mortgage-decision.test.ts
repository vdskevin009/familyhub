import test from "node:test";
import assert from "node:assert/strict";
import { compareMortgage, decisionTermsFor, latestDecisionProfile, rateScenarios, simulateLoan, validateDecisionProfile, validateDecisionTerms, validateRateScenario, type CostEvidence, type DecisionProfile, type DecisionTerms, type LoanInput } from "../apps/worker/src/mortgage-decision";
import type { Quote } from "../apps/worker/src/mortgage-model";

const today = "2026-01-01";
const charge = (amount: number | null = 0, financed = false): CostEvidence => ({ amount, financed, source: amount === null ? null : "Synthetic dated cost confirmation", asOf: amount === null ? null : today, validUntil: "2026-02-01" });
const monthly = (principal: number, nominal: number, months: number, convention = "semiannual") => {
  const r = convention === "semiannual" ? Math.pow(1 + nominal / 200, 1 / 6) - 1 : nominal / 1200;
  return r === 0 ? principal / months : principal * r / (1 - Math.pow(1 + r, -months));
};
const profile = (): DecisionProfile => ({ schema: 1, id: "synthetic-profile", recordedAt: "2026-01-01T17:00:00Z", source: "Synthetic contract", evidenceStatus: "documented", balanceAsOf: today, principal: 300000, currentRate: 5, remainingMonths: 300, maturityDate: "2027-01-01", nextPaymentDate: "2026-02-01", paymentAmount: Math.round(monthly(300000, 5, 300) * 100) / 100, rateType: "fixed", paymentMode: "fixed-payment", compounding: "semiannual", penalty: charge(), currentCashbackClawback: charge(), notes: [] });
const offer = (variable = false): Quote => ({ id: "synthetic-offer", receivedDate: today, source: "Synthetic received offer", lender: "Synthetic lender", product: variable ? "variable-5" : "fixed-5", variant: variable ? "adjustable-payment" : "fixed", rate: 4, limitations: ["Synthetic financial test"] });
const terms = (): DecisionTerms => ({ schema: 1, id: "synthetic-terms", offerId: "synthetic-offer", recordedAt: "2026-01-01T17:00:00Z", source: "Synthetic terms", validUntil: "2026-02-01", eligibility: "confirmed", offerStatus: "confirmed", compounding: "semiannual", paymentAmount: null, fees: charge(), cashback: charge(), cashbackPaidOn: null, cashbackClawback: charge(), conditions: [] });
const loan = (): LoanInput => ({ principal: 300000, annualRate: 5, remainingMonths: 300, startDate: today, endDate: "2031-01-01", nextPaymentDate: "2026-02-01", compounding: "semiannual", paymentMode: "adjustable-payment", paymentAmount: null });
const close = (actual: number, expected: number, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} differs from ${expected}`);

test("private evidence accepts unknowns without converting them to zero and selects latest revisions", () => {
  const p = profile(); p.principal = null; p.maturityDate = null; p.penalty = charge(null);
  assert.equal(validateDecisionProfile(p).principal, null);
  const t = terms(); t.fees = charge(null); t.cashback = charge(null);
  assert.equal(validateDecisionTerms(t).cashback.amount, null);
  assert.throws(() => validateDecisionProfile({ ...p, maturityDate: "2026-02-30" }));
  assert.throws(() => validateDecisionProfile({ ...profile(), nextPaymentDate: "2026-03-02" }));
  assert.throws(() => validateDecisionTerms({ ...t, fees: { ...charge(), source: null } }));
  assert.throws(() => validateDecisionTerms({ ...terms(), cashback: charge(100, true) }));
  const next = { ...profile(), id: "new", recordedAt: "2026-01-02T01:00:00Z" };
  assert.equal(latestDecisionProfile([next, profile()])?.id, "new");
  assert.equal(decisionTermsFor([terms(), { ...terms(), id: "new", recordedAt: next.recordedAt }], "synthetic-offer")?.id, "new");
  assert.equal(decisionTermsFor([terms()], "other"), undefined);
});

test("independent FCAC payment example, discounted cash flows and closed-form balance agree", () => {
  const result = simulateLoan(loan()), r = Math.pow(1.025, 1 / 6) - 1;
  close(result.initialPayment, 1744.81, .01); close(result.interest, 70211.42, .05);
  const closedBalance = 300000 * Math.pow(1 + r, 60) - result.initialPayment * (Math.pow(1 + r, 60) - 1) / r;
  close(result.balance, closedBalance);
  let presentValue = 0; for (let i = 1; i <= 300; i++) presentValue += result.initialPayment / Math.pow(1 + r, i);
  close(presentValue, 300000);
  close(result.totalPayments - result.interest, 300000 - result.balance);
});

test("comparison ends at current exact maturity and identical loans have zero gain", () => {
  const p = profile(), q = offer(), t = terms(); q.rate = p.currentRate!; t.paymentAmount = p.paymentAmount;
  const result = compareMortgage(p, q, t, today);
  assert.equal(result.status, "estimated"); assert.equal(result.endDate, p.maturityDate);
  assert.equal(result.current?.rows.length, 12); assert.equal(result.replacement?.rows.length, 12);
  close(result.netGain!, 0); close(result.monthlyPaymentChange!, 0);
  assert.equal(result.confirmed, true);
});

test("financed penalty remains a cost, adds interest, and is counted exactly once", () => {
  const p = profile(), q = offer(), t = terms();
  const free = compareMortgage(p, q, t, today);
  p.penalty = charge(5000, true); t.fees = charge(1000, false);
  const financed = compareMortgage(p, q, t, today);
  assert.equal(financed.costs.financed, 5000); assert.equal(financed.costs.upfront, 1000);
  assert.ok(financed.monthlyPaymentChange! > 0, "payment may fall despite costly switch");
  assert.ok(financed.netGain! < free.netGain! - 6000, "financed penalty also accrues interest");
  const expected = financed.current!.interest - financed.replacement!.interest - 5000 - 1000;
  close(financed.netGain!, expected);
  assert.ok(financed.uncertainties.some(reason => reason.includes("capital")));
});

test("cash-paid and financed fees reconcile cashflow plus debt, not payment difference", () => {
  const p = profile(), q = offer(), t = terms(); p.penalty = charge(2000); t.fees = charge(500);
  const a = compareMortgage(p, q, t, today);
  assert.equal(a.costs.upfront, 2500); assert.equal(a.costs.financed, 0);
  close(a.netGain!, a.current!.interest - a.replacement!.interest - 2500);
  assert.ok(Math.abs(a.monthlyPaymentChange! * 12 - 2500 - a.netGain!) > 100);
  p.penalty.financed = true; t.fees.financed = true;
  const b = compareMortgage(p, q, t, today);
  assert.ok(b.netGain! < a.netGain!, "financing costs interest instead of making fees free");
});

test("cashback timing and explicit recovery reduce the benefit without double counting", () => {
  const p = profile(), q = offer(), t = terms(); p.currentCashbackClawback = charge(200);
  t.cashback = charge(1000); t.cashbackPaidOn = "2026-07-01"; t.cashbackClawback = charge(250);
  t.conditions = ["Synthetic assumption: 250 recoverable at comparison horizon"];
  const result = compareMortgage(p, q, t, today);
  close(result.netGain!, result.current!.interest - result.replacement!.interest - 200 + 1000 - 250);
  assert.equal(result.costs.cashbackClawback, 250);
  t.cashbackPaidOn = "2027-02-01";
  const late = compareMortgage(p, q, t, today); assert.equal(late.costs.cashback, 0); assert.equal(late.costs.cashbackClawback, 0);
  t.cashbackPaidOn = null;
  assert.equal(compareMortgage(p, q, t, today).netGain, null);
});

test("missing maturity or any indispensable cost blocks net gain with a specific reason", () => {
  assert.equal(compareMortgage(undefined, offer(), undefined, today).netGain, null);
  for (const change of [(p: DecisionProfile, _t: DecisionTerms) => { p.maturityDate = null; }, (p: DecisionProfile, _t: DecisionTerms) => { p.penalty = charge(null); }, (_p: DecisionProfile, t: DecisionTerms) => { t.fees = charge(null); }, (_p: DecisionProfile, t: DecisionTerms) => { t.cashbackClawback = charge(null); }, (p: DecisionProfile, _t: DecisionTerms) => { p.paymentAmount = null; }]) {
    const p = profile(), t = terms(); change(p, t);
    const result = compareMortgage(p, offer(), t, today);
    assert.equal(result.status, "unavailable"); assert.equal(result.netGain, null); assert.equal(result.current, null); assert.ok(result.uncertainties.length);
  }
});

test("stale penalty, expired quote and contradictory amortization cannot produce actionable gain", () => {
  const p = profile(), t = terms(); p.penalty = { ...charge(), asOf: "2025-12-01", validUntil: null };
  assert.match(compareMortgage(p, offer(), t, today).uncertainties.join(" "), /Pénalité.*périmée/);
  t.validUntil = "2025-12-31";
  assert.match(compareMortgage(profile(), offer(), t, today).uncertainties.join(" "), /Offre expirée/);
  const short = profile(); short.remainingMonths = 6;
  assert.equal(compareMortgage(short, offer(), terms(), today).netGain, null);
  const long = profile(); long.maturityDate = "2030-01-01"; const q = offer(); q.product = "fixed-3";
  assert.match(compareMortgage(long, q, terms(), today).uncertainties.join(" "), /terme finit/);
});

test("partial final period is prorated, never rounded to a full extra month", () => {
  const result = simulateLoan({ ...loan(), endDate: "2026-01-16" });
  const r = Math.pow(1.025, 1 / 6) - 1;
  close(result.interest, 300000 * (Math.pow(1 + r, 15 / 31) - 1));
  assert.equal(result.totalPayments, 0); assert.equal(result.rows[0].date, "2026-01-16");
  const p = profile(); p.maturityDate = "2026-02-16";
  const compared = compareMortgage(p, offer(), terms(), today);
  assert.equal(compared.current?.rows.length, 2); assert.equal(compared.current?.rows[1].payment, 0);
  assert.equal(compared.endDate, "2026-02-16");
});

test("rate events split the actual interest period and never apply before their date", () => {
  const p = { ...loan(), endDate: "2026-02-01", paymentMode: "fixed-payment" as const, paymentAmount: 1800, rateEvents: [{ effectiveDate: "2026-01-16", annualRate: 6 }] };
  const result = simulateLoan(p), old = Math.pow(1.025, 1 / 6) - 1, changed = Math.pow(1.03, 1 / 6) - 1;
  close(result.interest, 300000 * (Math.pow(1 + old, 15 / 31) * Math.pow(1 + changed, 16 / 31) - 1));
  const before = simulateLoan({ ...p, endDate: "2026-01-10" });
  close(before.interest, simulateLoan({ ...p, endDate: "2026-01-10", rateEvents: [] }).interest);
});

test("five explicit dated stability/down/up paths affect variable interest, not fixed offers", () => {
  const paths = rateScenarios(today); assert.equal(paths.length, 5);
  assert.deepEqual(paths.map(s => s.events[0]?.changePercentagePoints ?? 0), [0, -.25, -.5, .25, .5]);
  assert.equal(paths[1].events[0].effectiveDate, "2026-02-01");
  const t = terms(); t.compounding = "monthly";
  const results = paths.map(path => compareMortgage(profile(), offer(true), t, today, path));
  assert.ok(results.every(r => r.status === "estimated"));
  assert.ok(results[2].replacement!.interest < results[1].replacement!.interest);
  assert.ok(results[1].replacement!.interest < results[0].replacement!.interest);
  assert.ok(results[0].replacement!.interest < results[3].replacement!.interest);
  assert.ok(results[3].replacement!.interest < results[4].replacement!.interest);
  close(results[0].replacement!.rows[0].interest, results[4].replacement!.rows[0].interest);
  assert.ok(results[4].replacement!.rows[1].payment > results[0].replacement!.rows[1].payment);
  const fixed = paths.map(path => compareMortgage(profile(), offer(), terms(), today, path));
  for (const result of fixed) close(result.netGain!, fixed[0].netGain!);
});

test("fixed-payment variable preserves its payment and shows growing debt beyond trigger", () => {
  const result = simulateLoan({ ...loan(), principal: 100000, annualRate: 3, remainingMonths: 300, endDate: "2026-04-01", compounding: "monthly", paymentMode: "fixed-payment", paymentAmount: 300, rateEvents: [{ effectiveDate: "2026-02-01", annualRate: 8 }] });
  assert.equal(result.rows[0].payment, 300); assert.equal(result.rows[1].payment, 300);
  assert.ok(result.rows[1].balance > result.rows[0].balance); assert.ok(result.warnings.some(w => w.includes("Amortissement négatif")));
  const q = offer(true); q.variant = "fixed-payment";
  assert.match(compareMortgage(profile(), q, terms(), today).uncertainties.join(" "), /Versement contractuel fixe/);
});

test("incomparable new payment and unknown payment structure do not masquerade as savings", () => {
  const t = terms(); t.paymentAmount = 500;
  assert.equal(compareMortgage(profile(), offer(), t, today).netGain, null);
  const q = offer(true); q.variant = "unconfirmed-payment";
  assert.equal(compareMortgage(profile(), q, terms(), today).netGain, null);
});

test("break-even uses economic gain and cannot be reached by positive cashflow alone", () => {
  const p = profile(); p.penalty = charge(10000, true);
  const bad = compareMortgage(p, offer(), terms(), today);
  assert.ok(bad.monthlyPaymentChange! > 0); assert.ok(bad.netGain! < 0);
  assert.equal(bad.breakEvenDate, null); assert.equal(bad.breakEvenMonths, null);
  p.penalty = charge(1000);
  const good = compareMortgage(p, offer(), terms(), today);
  assert.ok(good.netGain! > 0); assert.ok(good.breakEvenDate! > today); assert.ok(good.breakEvenDate! <= p.maturityDate!);
  const row = good.replacement!.rows.findIndex(r => r.date === good.breakEvenDate);
  for (let i = row; i < good.replacement!.rows.length; i++) {
    const a = good.current!.rows[i], b = good.replacement!.rows[i];
    assert.ok(a.cumulativePayments - b.cumulativePayments + a.balance - b.balance - 1000 >= -.005);
  }
});

test("balance projection is explicit and bounded; historical variable rate path is never invented", () => {
  const p = profile(); p.balanceAsOf = "2025-12-15"; p.nextPaymentDate = "2026-01-15";
  const result = compareMortgage(p, offer(), terms(), today);
  assert.equal(result.status, "estimated"); assert.ok(result.uncertainties.some(w => w.includes("Solde projeté")));
  p.rateType = "variable";
  assert.equal(compareMortgage(p, offer(), terms(), today).netGain, null);
  p.rateType = "fixed"; p.balanceAsOf = "2025-11-15"; p.nextPaymentDate = "2025-12-15";
  assert.match(compareMortgage(p, offer(), terms(), today).uncertainties.join(" "), /31 jours/);
});

test("prime provenance and user-reported profile cannot silently become a confirmed offer", () => {
  const p = profile(), t = terms(); p.evidenceStatus = "user-reported";
  t.prime = { lender: "Synthetic lender", rate: null, discountPoints: 1, asOf: today, source: "Synthetic original quote" };
  assert.equal(validateDecisionTerms(t).prime?.rate, null);
  assert.equal(compareMortgage(p, offer(true), t, today).confirmed, false);
  t.prime.rate = 5.5;
  assert.match(compareMortgage(profile(), offer(true), t, today).uncertainties.join(" "), /contredisent/);
});

test("scenario validation refuses ambiguous calendars, impossible rates and invented clamps", () => {
  const s = rateScenarios(today)[1];
  assert.throws(() => validateRateScenario({ ...s, events: [...s.events, ...s.events] }));
  assert.throws(() => validateRateScenario({ ...s, basis: "forecast" }));
  const q = offer(true); q.rate = .1;
  assert.equal(compareMortgage(profile(), q, terms(), today, s).netGain, null);
  assert.throws(() => simulateLoan({ ...loan(), rateEvents: [{ effectiveDate: "2025-12-31", annualRate: 5 }] }));
  assert.throws(() => simulateLoan({ ...loan(), compounding: "daily" as any }));
});

test("zero-rate amortization and calendar dates stay exact, including a fully paid loan", () => {
  const result = simulateLoan({ ...loan(), principal: 12000, annualRate: 0, remainingMonths: 12, endDate: "2027-01-01" });
  close(result.totalPayments, 12000); close(result.interest, 0); close(result.balance, 0);
  assert.equal(result.rows.length, 12);
  const fast = simulateLoan({ ...loan(), principal: 1000, annualRate: 0, remainingMonths: 12, endDate: "2026-04-01", paymentMode: "fixed-payment", paymentAmount: 1000 });
  assert.equal(fast.rows.length, 3); assert.equal(fast.rows[1].payment, 0); assert.equal(fast.rows[2].balance, 0);
  assert.equal(rateScenarios("2028-01-31")[1].events[0].effectiveDate, "2028-02-29");
});

test("break-even includes immediate costs and refuses a temporary cashback crossing", () => {
  const p = profile(), t = terms(); t.cashback = charge(1000); t.cashbackPaidOn = today;
  t.conditions = ["Synthetic cashback retained through comparison horizon"];
  const profitable = compareMortgage(p, offer(), t, today);
  assert.equal(profitable.breakEvenDate, today); assert.equal(profitable.breakEvenMonths, 0);
  const q = offer(); q.rate = 6;
  const temporary = compareMortgage(p, q, t, today);
  assert.ok(temporary.netGain! < 0); assert.equal(temporary.breakEvenDate, null);
  t.cashbackPaidOn = "2026-07-01"; p.penalty = charge(5000);
  const notYet = compareMortgage(p, offer(), t, today);
  assert.ok(notYet.breakEvenDate === null || notYet.breakEvenDate >= t.cashbackPaidOn);
});

test("configured quote age and future private revisions are respected", () => {
  const q=offer(),t=terms();q.receivedDate="2025-12-20";t.validUntil=null;
  assert.equal(compareMortgage(profile(),q,t,today,undefined,{maximumQuoteAgeDays:14}).status,"estimated");
  assert.equal(compareMortgage(profile(),q,t,today,undefined,{maximumQuoteAgeDays:7}).status,"unavailable");
  const p=profile();p.recordedAt="2026-01-03T01:00:00Z";
  assert.equal(compareMortgage(p,offer(),terms(),today).netGain,null);
  const future=terms();future.recordedAt="2026-01-03T01:00:00Z";
  assert.equal(compareMortgage(profile(),offer(),future,today).netGain,null);
  assert.throws(()=>compareMortgage(profile(),offer(),terms(),today,undefined,{maximumQuoteAgeDays:0}));
});
