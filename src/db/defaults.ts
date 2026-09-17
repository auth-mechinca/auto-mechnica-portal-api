import { asc, eq } from 'drizzle-orm';
import type { Tx } from './client.js';
import { locations, settings } from './schema/index.js';

/** Shop-wide values more than one module needs. Both were local to the POS
 *  service until Backoffice needed them too. */

/** The demo runs on one location. It is resolved rather than hardcoded so that
 *  adding the selector later is a change of argument, not of logic. */
export async function defaultLocationId(tx: Tx): Promise<string> {
  const [location] = await tx
    .select({ id: locations.id })
    .from(locations)
    .where(eq(locations.isActive, true))
    .orderBy(asc(locations.createdAt))
    .limit(1);

  if (!location) throw new Error('No active location — run `npm run db:seed`');
  return location.id;
}

export async function settingValue(tx: Tx, key: string, fallback: string): Promise<string> {
  const [row] = await tx.select().from(settings).where(eq(settings.key, key)).limit(1);
  return row?.value ?? fallback;
}
