/** Single entry point that drizzle.config.ts points at — every table must be
 *  reachable from here or it will silently be left out of generated migrations. */
export * from './schema.js';
export * from './enums.js';
export * from './auth.js';
export * from './catalog.js';
export * from './inventory.js';
export * from './purchasing.js';
export * from './sales.js';
export * from './financial.js';
