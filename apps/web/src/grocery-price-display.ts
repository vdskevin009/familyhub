/** Display the actual observed package amount; normalized-rate calculations stay separate. */
export function packagePrice(amount: number, currency: string) {
  if (amount > 0 && amount < .01) return `<0,01 ${currency}`;
  return `${new Intl.NumberFormat("fr-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)} ${currency}`;
}
