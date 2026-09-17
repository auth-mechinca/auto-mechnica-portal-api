/** Exact decimal arithmetic for seed figures.
 *
 *  The same reason the schema stores money as `numeric` and hands it back as a
 *  string: 18.40 * 12.5 in floating point is not 230. Seed data that disagrees
 *  with what the API will later compute is worse than no seed data, so the
 *  arithmetic here runs on scaled integers and rounds half-up.
 *
 *  Positive values only — that is all seeds deal in.
 */

const split = (value: string): readonly [bigint, number] => {
  const [whole = '0', fraction = ''] = value.split('.');
  return [BigInt(whole + fraction), fraction.length];
};

const format = (value: bigint, dp: number): string => {
  const digits = value.toString().padStart(dp + 1, '0');
  return dp === 0 ? digits : `${digits.slice(0, -dp)}.${digits.slice(-dp)}`;
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
