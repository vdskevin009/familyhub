import { mortgageScenario, type Quote, type MortgageAssumptions } from "../../../worker/src/mortgage-model";
import { cad, percent } from "../mortgage-display";
export function QuoteIllustration({rate,quote,assumptions:a}:{rate:number;quote:Quote;assumptions:MortgageAssumptions|undefined}) {
  if(!a) return <p>Private assumptions unavailable. Save them on the PC to calculate this illustration.</p>;
  if(quote.variant === "unconfirmed-payment") return <p>Payment structure not confirmed. No payment or interest comparison is calculated for this quote.</p>;
  if(quote.variant === "fixed-payment") return <p>A fixed-payment variable loan needs the contractual payment and lender rules to estimate payments and interest. No cash flow savings are assumed.</p>;
  const months=quote.product.endsWith("3")?36:60,current=mortgageScenario(a.principal,a.currentRate,a.remainingMonths,months),offer=mortgageScenario(a.principal,rate,a.remainingMonths,months,quote.product.startsWith("variable")?"monthly":"semiannual");
  return <><p>Constant-rate illustration: {cad(a.principal)} and {a.remainingMonths} assumed months remaining, supplied current rate {percent(a.currentRate)}. Penalty and fees excluded. The current rate is held constant throughout; its maturity still needs confirmation. {quote.product.startsWith("variable") ? "Monthly compounding assumed. Future payments are not guaranteed." : "Canadian semi-annual compounding."}</p><dl className="mortgage-numbers"><div><dt>Illustrative monthly payment</dt><dd>{cad(offer.payment)}</dd></div><div><dt>Monthly payment reduction</dt><dd>{cad(current.payment-offer.payment)}</dd></div><div><dt>Interest avoided over {months} months</dt><dd>{cad(current.interest-offer.interest)}</dd></div></dl></>;
}
