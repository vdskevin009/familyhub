/** Presentation only: an absent amount is never evidence of a reported zero. */
export function sumKnownAmounts(values: readonly (number | null | undefined)[]) {
  const known = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const unknown = values.length - known.length;
  return { amount: known.length || !unknown ? known.reduce((total, value) => total + value, 0) : null, unknown };
}
