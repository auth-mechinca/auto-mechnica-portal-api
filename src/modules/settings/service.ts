import { z } from 'zod';
import { getDb } from '../../db/client.js';
import { defaultLocation, settingValue } from '../../db/defaults.js';
import { settings } from '../../db/schema/index.js';

/** Shop-wide settings — the Settings screen under Admin.
 *
 *  This lived on the backoffice router, which meant a purchasing officer could
 *  change the margin that prices the whole catalogue. It is its own module now
 *  because three modules read these values — pricing takes the margin,
 *  invoicing the payment terms, POS the currency — and a thing three modules
 *  read is not owned by one of them.
 *
 *  Reading a setting inside a service still goes through `settingValue`
 *  directly. This module is the screen, not the accessor.
 */

/* ------------------------------------------------------------------ input */

export const updateSettingsInput = z.object({
  /** Below 100 because a margin is a share of the selling price: at 100% the
   *  price would have to be infinite, and beyond it, negative. */
  defaultMarginPct: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/)
    .refine((value) => Number(value) < 100, 'A margin must be under 100%'),
});
export type UpdateSettingsInput = z.infer<typeof updateSettingsInput>;

/* ----------------------------------------------------------------- output */

export const settingsResponse = z.object({
  /** The only field on the screen that can be changed. */
  defaultMarginPct: z.string(),
  /** Read-only. A constant rather than a row: nothing in this build prices in
   *  anything else, and offering the choice would promise a conversion the
   *  system cannot do. */
  sellingCurrency: z.literal('GHS'),
  /** Read-only, and returned rather than hardcoded in the UI so that the day a
   *  second shop arrives the screen starts saying something different without a
   *  frontend change. */
  location: z.object({ id: z.string().uuid(), name: z.string() }),
});
export type SettingsResponse = z.infer<typeof settingsResponse>;

/* -------------------------------------------------------------- behaviour */

export async function getSettings(): Promise<SettingsResponse> {
  return getDb().transaction(async (tx) => ({
    defaultMarginPct: await settingValue(tx, 'default_margin_pct', '35'),
    sellingCurrency: 'GHS' as const,
    location: await defaultLocation(tx),
  }));
}

/** Changes what future receipts and price screens suggest. Prices already saved
 *  are left alone: they were decisions taken at the margin of the day, and
 *  rewriting them would silently reprice the whole catalogue. */
export async function updateSettings(input: UpdateSettingsInput): Promise<SettingsResponse> {
  await getDb()
    .insert(settings)
    .values({ key: 'default_margin_pct', value: input.defaultMarginPct })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: input.defaultMarginPct, updatedAt: new Date() },
    });

  return getSettings();
}
