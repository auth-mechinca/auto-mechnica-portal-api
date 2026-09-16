import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';

/** Work factor. Raising it later is safe — every hash stores the cost it was
 *  made with, so existing passwords keep verifying at their old factor. */
export const BCRYPT_COST = 12;

export const hashPassword = (plain: string): Promise<string> => bcrypt.hash(plain, BCRYPT_COST);

/** A real hash, of a random value nobody holds, generated once at startup.
 *
 *  Compared against when the email does not exist, so that a login attempt for
 *  an unknown account costs the same as one for a known account with the wrong
 *  password. Without it, "no such user" returns immediately while a real user
 *  costs a full bcrypt round, and the difference tells an attacker which emails
 *  are registered.
 *
 *  It must be a genuine hash at the SAME cost as stored passwords. A
 *  hand-written placeholder does not work: bcrypt rejects a malformed string in
 *  microseconds, which leaks exactly the difference this is meant to hide.
 */
const DUMMY_HASH = bcrypt.hashSync(randomBytes(32).toString('hex'), BCRYPT_COST);

/** Verifies a password, doing the same work whether or not the account exists. */
export async function verifyPassword(plain: string, hash: string | undefined): Promise<boolean> {
  const matched = await bcrypt.compare(plain, hash ?? DUMMY_HASH);
  return hash !== undefined && matched;
}
