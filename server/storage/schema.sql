-- SQLite stores the document, not a normalized schema. `kv` is the only
-- table LocalBarRepository's `StorageLike` needs; `kv_history` is a
-- gzip-compressed version history of every value `kv` has ever held (see
-- `kv-history.ts`), so a mis-tap can be undone instead of being permanent.
--
-- `synchronous = FULL` is deliberate and load-bearing: this machine loses
-- power with the lid closed. Do not "optimise" it to NORMAL.
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kv_history (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,
  value_gz BLOB NOT NULL,
  written_at TEXT NOT NULL
);
