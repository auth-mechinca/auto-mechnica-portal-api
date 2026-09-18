import { asc, eq, sql } from 'drizzle-orm';
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { getDb } from '../../db/client.js';
import { users } from '../../db/schema/index.js';
import { ApiError } from '../../lib/http.js';
import { hashPassword } from '../../lib/password.js';
import { ROLES } from '../../lib/token.js';

/** Staff accounts and their roles — the Users and Roles screen, admin only.
 *
 *  A user has exactly one role. There are no custom permission sets in this
 *  build, which is why this module has no concept of a permission at all: the
 *  role *is* the permission, and what each role reaches is decided by the
 *  `requireRole` on each router rather than by anything stored here.
 *
 *  Users are never deleted. Deactivating stops sign-in while keeping their name
 *  on the sales, receipts and adjustments they made — a foreign key to a deleted
 *  person would either fail or quietly orphan that history.
 */

/* ------------------------------------------------------------------ input */

export const userIdParam = z.object({ id: z.string().uuid() });
export type UserIdParam = z.infer<typeof userIdParam>;

/** Trimmed and lowercased here rather than trusted from the caller, so that the
 *  clash check below and the unique index see the same string. */
const email = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(200)
  .refine((value) => !/\s/.test(value), 'An email address cannot contain spaces');

export const createUserInput = z.object({
  fullName: z.string().trim().min(1).max(200),
  email,
  role: z.enum(ROLES),
  isActive: z.boolean().default(true),
});
export type CreateUserInput = z.infer<typeof createUserInput>;

export const updateUserInput = z
  .object({
    fullName: z.string().trim().min(1).max(200).optional(),
    email: email.optional(),
    role: z.enum(ROLES).optional(),
    isActive: z.boolean().optional(),
  })
  .refine(
    (input) => Object.values(input).some((value) => value !== undefined),
    'Send at least one field to change',
  );
export type UpdateUserInput = z.infer<typeof updateUserInput>;

/* ----------------------------------------------------------------- output */

export const userRow = z.object({
  id: z.string().uuid(),
  fullName: z.string(),
  email: z.string(),
  role: z.enum(ROLES),
  isActive: z.boolean(),
  /** Null until they have signed in once. */
  lastSignInAt: z.string().nullable(),
});
export type UserRow = z.infer<typeof userRow>;

/** A created user, with the one and only sight of their password.
 *
 *  It is generated rather than chosen by the admin, and returned exactly once:
 *  only the hash is stored, so this response is the sole moment the plaintext
 *  exists anywhere. An admin who loses it cannot look it up. */
export const createdUser = userRow.extend({ temporaryPassword: z.string() });
export type CreatedUser = z.infer<typeof createdUser>;

/* -------------------------------------------------------------- behaviour */

/** Unambiguous by construction: no O/0, no I/l/1. A password read aloud across
 *  a counter or written on a slip should not need spelling out. */
const PASSWORD_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

function generatePassword(): string {
  const pick = () => PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)]!;
  const block = (length: number) => Array.from({ length }, pick).join('');
  return `${block(4)}-${block(4)}-${block(4)}`;
}

const select = {
  id: users.id,
  fullName: users.fullName,
  email: users.email,
  role: users.role,
  isActive: users.isActive,
  lastSignInAt: sql<string | null>`to_char(${users.lastSignInAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`,
};

/** Everyone, active and inactive together, because the screen shows both in one
 *  table with a status column rather than behind a filter. */
export async function listUsers(): Promise<UserRow[]> {
  return getDb().select(select).from(users).orderBy(asc(users.fullName));
}

export async function getUser(id: string): Promise<UserRow> {
  const [user] = await getDb().select(select).from(users).where(eq(users.id, id)).limit(1);
  if (!user) throw ApiError.notFound('No such user');
  return user;
}

async function assertEmailFree(candidate: string, exceptId?: string): Promise<void> {
  const [clash] = await getDb()
    .select({ email: users.email })
    .from(users)
    .where(
      exceptId === undefined
        ? sql`lower(${users.email}) = ${candidate}`
        : sql`lower(${users.email}) = ${candidate} and ${users.id} <> ${exceptId}`,
    )
    .limit(1);

  if (clash) throw ApiError.conflict(`${clash.email} already has an account`);
}

export async function createUser(input: CreateUserInput): Promise<CreatedUser> {
  await assertEmailFree(input.email);

  const temporaryPassword = generatePassword();
  const [user] = await getDb()
    .insert(users)
    .values({
      fullName: input.fullName,
      email: input.email,
      role: input.role,
      isActive: input.isActive,
      passwordHash: await hashPassword(temporaryPassword),
    })
    .returning(select);

  return { ...user!, temporaryPassword };
}

/** `actingUserId` is the admin making the change, and it is here for one reason:
 *  to stop them locking themselves out. Deactivating your own account, or moving
 *  yourself off admin, would end your session on the very next request — because
 *  the role is now read from the row rather than the token — and leave nobody
 *  able to undo it if you were the only admin. The screen says as much: your own
 *  row offers no Edit. */
export async function updateUser(
  id: string,
  input: UpdateUserInput,
  actingUserId: string,
): Promise<UserRow> {
  const existing = await getUser(id);

  if (id === actingUserId) {
    if (input.isActive === false) {
      throw ApiError.badRequest('You cannot deactivate your own account');
    }
    if (input.role !== undefined && input.role !== existing.role) {
      throw ApiError.badRequest('You cannot change your own role');
    }
  }

  if (input.email !== undefined) await assertEmailFree(input.email, id);

  const [user] = await getDb()
    .update(users)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning(select);

  return user!;
}
