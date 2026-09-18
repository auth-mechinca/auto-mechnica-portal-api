import { sql } from 'drizzle-orm';
import { getDb } from './client.js';
import type { Role } from '../lib/token.js';

/** What a presented token is worth right now.
 *
 *  A JWT states who the holder was when it was signed. That is not the same as
 *  who they are: an admin can change somebody's role or switch their account off
 *  while they are working, and the Users screen promises that takes effect on
 *  their next request rather than whenever their token happens to run out.
 *
 *  So the role is read from the database on every request and the claim is
 *  ignored. This costs nothing extra: `requireAuth` already had to ask the
 *  database whether the token had been signed out, and that lookup now returns
 *  the user row with it. One round trip, as before.
 */
export type LiveSession = {
  revoked: boolean;
  user: { id: string; email: string; fullName: string; role: Role; isActive: boolean } | null;
};

export async function loadSession(userId: string, jti: string): Promise<LiveSession> {
  const { rows } = await getDb().execute<{
    id: string | null;
    email: string | null;
    full_name: string | null;
    role: Role | null;
    is_active: boolean | null;
    revoked: boolean;
  }>(sql`
    select u.id,
           u.email,
           u.full_name,
           u.role,
           u.is_active,
           exists (select 1 from app.revoked_tokens r where r.jti = ${jti}) as revoked
      from (select ${jti}::uuid as probe) as _
      left join app.users u on u.id = ${userId}::uuid
  `);

  const row = rows[0];
  // The left join guarantees a row even when the user is gone, so `rows[0]`
  // being absent would mean the query itself changed shape.
  if (!row) throw new Error('loadSession returned no row');

  return {
    revoked: row.revoked,
    user:
      row.id === null
        ? null
        : {
            id: row.id,
            email: row.email!,
            fullName: row.full_name!,
            role: row.role!,
            isActive: row.is_active!,
          },
  };
}
