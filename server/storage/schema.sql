-- SQLite stores the document, not a normalized schema. `kv` is the only
-- table: LocalBarRepository's `StorageLike` needs nothing else.
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
