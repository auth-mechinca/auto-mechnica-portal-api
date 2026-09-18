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

/** Zero means an account settles on the day of the invoice. The cap is there
 *  because a year of credit is a typo rather than a policy. One range, used to
 *  validate what comes in and to describe what goes out. */
const TERMS_DAYS = { min: 0, max: 365, fallback: 30 } as const;

/* ------------------------------------------------------------------ input */

/** Both fields are optional and at least one is required, which is what a PATCH
 *  of a two-field form should accept: the screen sends what changed. */
export const updateSettingsInput = z
  .object({
    /** Below 100 because a margin is a share of the selling price: at 100% the
     *  price would have to be infinite, and beyond it, negative. */
    defaultMarginPct: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/)
      .refine((value) => Number(value) < 100, 'A margin must be under 100%')
      .optional(),
    /** Whole days, `TERMS_DAYS` apart. */
    defaultPaymentTermsDays: z
      .number()
      .int()
      .min(TERMS_DAYS.min)
      .max(TERMS_DAYS.max)
      .optional(),
  })
  .refine(
    (input) => Object.values(input).some((value) => value !== undefined),
    'Send at least one setting to change',
  );
export type UpdateSettingsInput = z.infer<typeof updateSettingsInput>;

/* ----------------------------------------------------------------- output */

export const settingsResponse = z.object({
  defaultMarginPct: z.string(),
  /** A count of days, so a number rather than a string. The margin beside it is
   *  a string because it is a decimal that has to round-trip exactly; an
   *  integer has no such problem, and typing it honestly lets the screen render
   *  a number field. */
  defaultPaymentTermsDays: z.number().int().min(TERMS_DAYS.min).max(TERMS_DAYS.max),
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

/** Settings are stored as text and the column would accept anything, so the
 *  days are parsed rather than cast. Anything that is not a whole number in
 *  range falls back to the default: only a hand-edit of the table can produce
 *  one, and a screen showing `NaN` days is worse than one showing 30. Keeping
 *  the guard to the same range the PATCH enforces is what lets the response
 *  schema state that range honestly. */
const wholeDays = (value: string): number => {
  const parsed = Number(value);
  const usable =
    Number.isInteger(parsed) && parsed >= TERMS_DAYS.min && parsed <= TERMS_DAYS.max;
  return usable ? parsed : TERMS_DAYS.fallback;
};

export async function getSettings(): Promise<SettingsResponse> {
  return getDb().transaction(async (tx) => ({
    defaultMarginPct: await settingValue(tx, 'default_margin_pct', '35'),
    defaultPaymentTermsDays: wholeDays(
      await settingValue(tx, 'default_payment_terms_days', String(TERMS_DAYS.fallback)),
    ),
    sellingCurrency: 'GHS' as const,
    location: await defaultLocation(tx),
  }));
}

/** Both settings apply from here on and neither reaches backwards.
 *
 *  A new margin changes what price management suggests next; prices already
 *  confirmed are decisions somebody took at the margin of the day, and
 *  rewriting them would silently reprice the catalogue.
 *
 *  New terms change the due date of invoices raised next. `due_date` is stamped
 *  on the invoice when it is raised, not derived on read, so an invoice keeps
 *  the terms in force the day it was issued — otherwise moving 30 days to 45
 *  would re-age the whole ledger overnight and a customer ten days late would
 *  quietly become five days early. */
export async function updateSettings(input: UpdateSettingsInput): Promise<SettingsResponse> {
  const changes: { key: string; value: string }[] = [];
  if (input.defaultMarginPct !== undefined) {
    changes.push({ key: 'default_margin_pct', value: input.defaultMarginPct });
  }
  if (input.defaultPaymentTermsDays !== undefined) {
    changes.push({
      key: 'default_payment_terms_days',
      value: String(input.defaultPaymentTermsDays),
    });
  }

  await getDb().transaction(async (tx) => {
    for (const change of changes) {
      await tx
        .insert(settings)
        .values(change)
        .onConflictDoUpdate({
          target: settings.key,
          set: { value: change.value, updatedAt: new Date() },
        });
    }
  });

  return getSettings();
}
