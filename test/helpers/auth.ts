import { signToken, type Role } from '../../src/lib/token.js';

/** Bearer tokens for the fixture's staff.
 *
 *  Kept out of `fixtures.ts` on purpose: this module pulls in `jsonwebtoken` and
 *  the config schema behind it, and fixtures are imported by every
 *  database-backed file in the suite — including the ones that never make an
 *  HTTP request and have no use for a token.
 */
type Staffed = { staff: Record<Role, { id: string; email: string }> };

export function tokenFor(base: Staffed, role: Role): string {
  const who = base.staff[role];
  return signToken({ sub: who.id, email: who.email, role });
}

/** The Authorization header, which is what most call sites actually want. */
export const authAs = (base: Staffed, role: Role) => ({
  Authorization: `Bearer ${tokenFor(base, role)}`,
});
