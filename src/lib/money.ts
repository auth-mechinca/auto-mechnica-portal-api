/** Exact decimal arithmetic for seed figures.
 *
 *  The same reason the schema stores money as `numeric` and hands it back as a
 *  string: 18.40 * 12.5 in floating point is not 230. Seed data that disagrees
 *  with what the API will later compute is worse than no seed data, so the
 *  arithmetic here runs on scaled integers and rounds half-up.
 *
 *  multiply() and the pricing helpers assume positive values; add(), subtract()
 *  and compare() handle negatives, which change calculations need.
 */

const split = (value: string): readonly [bigint, number] => {
  const [whole = '0', fraction = ''] = value.split('.');
  return [BigInt(whole + fraction), fraction.length];
};

const format = (value: bigint, dp: number): string => {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(dp + 1, '0');
  const rendered = dp === 0 ? digits : `${digits.slice(0, -dp)}.${digits.slice(-dp)}`;
  return negative ? `-${rendered}` : rendered;
};

export function multiply(a: string, b: string, dp = 2): string {
  const [aInt, aDp] = split(a);
  const [bInt, bDp] = split(b);
  const raw = aInt * bInt;
  const rawDp = aDp + bDp;

  if (rawDp <= dp) return format(raw * 10n ** BigInt(dp - rawDp), dp);

  const divisor = 10n ** BigInt(rawDp - dp);
  const quotient = raw / divisor;
  const remainder = raw % divisor;
  return format(remainder * 2n >= divisor ? quotient + 1n : quotient, dp);
}

/** Widens two values to a common scale so they can be compared or added. */
const align = (a: string, b: string): readonly [bigint, bigint, number] => {
  const [aInt, aDp] = split(a);
  const [bInt, bDp] = split(b);
  const dp = Math.max(aDp, bDp);
  return [aInt * 10n ** BigInt(dp - aDp), bInt * 10n ** BigInt(dp - bDp), dp];
};

export function add(a: string, b: string): string {
  const [aInt, bInt, dp] = align(a, b);
  return format(aInt + bInt, dp);
}

export const sum = (values: readonly string[]): string => values.reduce(add, '0.00');

/** -1 if a < b, 0 if equal, 1 if a > b. */
export function compare(a: string, b: string): -1 | 0 | 1 {
  const [aInt, bInt] = align(a, b);
  return aInt === bInt ? 0 : aInt < bInt ? -1 : 1;
}

/** Exact division, rounded half-up to `dp`. Positive values only. */
export function divide(a: string, b: string, dp = 2): string {
  const [aInt, aDp] = split(a);
  const [bInt, bDp] = split(b);
  if (bInt === 0n) throw new RangeError('Division by zero');

  // a/b scaled to dp: (aInt * 10^(bDp + dp)) / (bInt * 10^aDp)
  const numerator = aInt * 10n ** BigInt(bDp + dp);
  const denominator = bInt * 10n ** BigInt(aDp);

  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return format(remainder * 2n >= denominator ? quotient + 1n : quotient, dp);
}

export function subtract(a: string, b: string): string {
  const [aInt, bInt, dp] = align(a, b);
  return format(aInt - bInt, dp);
}

/** landed cost (GHS) = unit cost (USD) x FX rate (GHS per USD). Section 6.4 —
 *  this multiplication is the step that makes the figure Cedis. */
export const landedCost = (unitCostUsd: string, fxRate: string): string =>
  multiply(unitCostUsd, fxRate);

/** suggested price, from a margin **on the selling price**. Section 6.3.
 *
 *  This is the accountant's definition, confirmed with the client: a 35% margin
 *  means 35% of what the customer pays, not 35% added to cost.
 *
 *      margin = (price - cost) / price
 *   => price  = cost / (1 - margin/100)
 *             = cost * 100 / (100 - margin)
 *
 *  It is worth being explicit because the two readings diverge quickly. At 35%,
 *  a markup on cost multiplies by 1.35; a margin on price multiplies by 1.538.
 *  On a part costing GH¢ 291.40 that is GH¢ 393.39 against GH¢ 448.31.
 *
 *  Expressed as a division by a whole number rather than by a decimal, so the
 *  rounding happens once, at the end.
 */
export function suggestedPrice(landed: string, marginPct: string): string {
  const share = subtract('100', marginPct);

  // A 100% margin would mean selling at infinity, and beyond that the price
  // turns negative — nonsense that should fail loudly rather than quietly.
  if (compare(share, '0') <= 0) {
    throw new RangeError(`A margin of ${marginPct}% leaves nothing to price against`);
  }

  return divide(multiply(landed, '100', 4), share);
}
