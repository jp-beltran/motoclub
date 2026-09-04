/**
 * The schema SQL, inlined as a literal string rather than read from disk at
 * runtime.
 *
 * The original design read `schema.sql` from a path computed via
 * `import.meta.url` inside `main.ts`. That only works because `main.ts`
 * always runs *bundled* (esbuild collapses every bundled module's
 * `import.meta.url` to the single `server/dist/server.mjs` path) — the
 * moment any code needs to open a database from an *unbundled* context too
 * (this project's own tests: `sqlite-storage.test.ts`, `router.test.ts`,
 * and `main.test.ts` via `bootServer`, all run directly under vitest, never
 * through esbuild), the same relative offset is wrong, because
 * `server/main.ts` (unbundled) and `server/dist/server.mjs` (bundled) sit
 * at different depths relative to `server/storage/schema.sql`. No single
 * `../whatever/schema.sql` offset is correct in both worlds at once.
 *
 * Embedding the SQL as a source-code string sidesteps the problem
 * entirely: importing this module resolves through ordinary
 * ESM/TypeScript module resolution — correct at any bundling depth,
 * because esbuild inlines the already-resolved string, no runtime
 * filesystem path arithmetic involved.
 *
 * `schema.sql` still exists alongside this file, byte-for-byte identical,
 * so a human (or `sqlite3 bar.sqlite3 < server/storage/schema.sql`) has a
 * plain, syntax-highlighted copy to read; `schema.test.ts` asserts the two
 * never drift apart.
 */
export const SCHEMA_SQL = `-- SQLite stores the document, not a normalized schema. \`kv\` is the only
-- table: LocalBarRepository's \`StorageLike\` needs nothing else.
--
-- \`synchronous = FULL\` is deliberate and load-bearing: this machine loses
-- power with the lid closed. Do not "optimise" it to NORMAL.
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL
);
`
