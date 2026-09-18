import { asc, eq } from 'drizzle-orm';
import type { Tx } from './client.js';
import { locations, settings } from './schema/index.js';

/** Shop-wide values more than one module needs. Both were local to the POS
 *  service until Backoffice needed them too. */

/** The demo runs on one location. It is resolved rather than hardcoded so that
 *  adding the selector later is a change of argument, not of logic. */
export async function defaultLocation(tx: Tx): Promise<{ id: string; name: string }> {
  const [location] = await tx
    .select({ id: locations.id, name: locations.name })
    .from(locations)
    .where(eq(locations.isActive, true))
    .orderBy(asc(locations.createdAt))
    .limit(1);

  if (!location) throw new Error('No active location — run `npm run db:seed`');
  return location;
}

/** Most callers only move stock and want the id. Settings shows the name to the
 *  owner, so both go through one definition of which location is "the" one —
 *  otherwise the screen could name a different shop from the one being sold out
 *  of. */
export async function defaultLocationId(tx: Tx): Promise<string> {
  return (await defaultLocation(tx)).id;
}

export async function settingValue(tx: Tx, key: string, fallback: string): Promise<string> {
  const [row] = await tx.select().from(settings).where(eq(settings.key, key)).limit(1);
  return row?.value ?? fallback;
}
