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

export function subtract(a: string, b: string): string {
  const [aInt, bInt, dp] = align(a, b);
  return format(aInt - bInt, dp);
}

/** landed cost (GHS) = unit cost (USD) x FX rate (GHS per USD). Section 6.4 —
 *  this multiplication is the step that makes the figure Cedis. */
export const landedCost = (unitCostUsd: string, fxRate: string): string =>
  multiply(unitCostUsd, fxRate);

/** suggested price = landed cost x (1 + margin%/100). Section 6.3.
 *
 *  The multiplier is built as an exact decimal string — a 35% margin becomes
 *  '1.35' by integer arithmetic, never by dividing in floating point. */
export const suggestedPrice = (landed: string, marginPct: string): string => {
  const [marginInt, marginDp] = split(marginPct);
  const multiplier = format(marginInt + 100n * 10n ** BigInt(marginDp), marginDp + 2);
  return multiply(landed, multiplier);
};
