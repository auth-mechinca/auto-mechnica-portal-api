/** Imported for its side effect, before anything that reads config. Keeps every
 *  test file from having to remember the same four lines. */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgres://unused:unused@localhost:5432/unused';
process.env.JWT_SECRET ??= 'test-secret-that-is-at-least-32-characters-long';
process.env.CORS_ORIGIN ??= 'http://localhost:3000';
