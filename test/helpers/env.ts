/** Imported for its side effect, before anything that reads config. Keeps every
 *  test file from having to remember the same four lines. */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgres://unused:unused@localhost:5432/unused';
process.env.JWT_SECRET ??= 'test-secret-that-is-at-least-32-characters-long';
process.env.CORS_ORIGIN ??= 'http://localhost:3000';
/** Cheap hashing for the suite. Nothing here asserts that bcrypt is slow, and at
 *  the production factor the fixed cost of `DUMMY_HASH` alone is paid once per
 *  test file. Ignored outside NODE_ENV=test — see src/lib/password.ts. */
process.env.BCRYPT_COST ??= '4';
