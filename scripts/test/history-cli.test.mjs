import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(SCRIPT_DIR, '..', '..');
const CLI_PATH = path.join(REPO_ROOT, 'scripts', 'history.mjs');
const SCHEMA_SQL = readFileSync(path.join(REPO_ROOT, 'server', 'storage', 'schema.sql'), 'utf8');

const KEY = 'motoclub:bar-database';

before(() => {
  // Build fresh so these tests do not depend on some earlier `npm run
  // build:server` having already been run, or on a stale artifact — same
  // reasoning as server/main.test.ts's own fresh-build-before-forking step.
  execFileSync(
    'npx',
    ['esbuild', 'server/main.ts', '--bundle', '--platform=node', '--format=esm', '--target=node22', '--outfile=server/dist/server.mjs'],
    { cwd: REPO_ROOT, stdio: 'ignore' },
  );
});

/** Builds a throwaway sqlite file with the real schema applied and one
 * `kv` row per envelope in `envelopes`, each also recorded as its own
 * `kv_history` row — mirroring exactly what a run of `SqliteStorage.setItem`
 * produces (gzip-compressed value, own `written_at`), without depending on
 * the TS build to construct the fixture. */
function buildTestDatabase(envelopes) {
  const dir = mkdtempSync(path.join(tmpdir(), 'history-cli-test-'));
  const dbPath = path.join(dir, 'bar.sqlite3');
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA_SQL);
  for (const [index, envelope] of envelopes.entries()) {
    const value = JSON.stringify(envelope);
    const writtenAt = `2026-01-01T00:00:${String(index).padStart(2, '0')}.000Z`;
    db.prepare(
      `INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).run(KEY, value, writtenAt);
    db.prepare('INSERT INTO kv_history (key, value_gz, written_at) VALUES (?, ?, ?)').run(
      KEY,
      gzipSync(Buffer.from(value, 'utf8')),
      writtenAt,
    );
  }
  db.close();
  return { dir, dbPath };
}

function runCli(args, env = {}) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function currentValue(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare('SELECT value FROM kv WHERE key = ?').get(KEY)?.value;
  } finally {
    db.close();
  }
}

function historyCount(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare('SELECT COUNT(*) as c FROM kv_history').get().c;
  } finally {
    db.close();
  }
}

describe('history.mjs list', () => {
  test('prints every version, most recent first, with size and timestamp', () => {
    const { dir, dbPath } = buildTestDatabase([
      { version: 1, data: { consumers: [] } },
      { version: 1, data: { consumers: [{ id: 'c1' }] } },
    ]);
    try {
      const result = runCli(['list', '--db', dbPath]);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /\[#1\].*2026-01-01T00:00:00\.000Z/);
      assert.match(result.stdout, /\[#2\].*2026-01-01T00:00:01\.000Z/);
      // most recent first
      assert.ok(result.stdout.indexOf('[#2]') < result.stdout.indexOf('[#1]'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('says so, rather than printing an empty table, when there is no history yet', () => {
    const { dir, dbPath } = buildTestDatabase([]);
    try {
      const result = runCli(['list', '--db', dbPath]);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /nenhuma versão/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('fails clearly when the database file does not exist', () => {
    const result = runCli(['list', '--db', '/does/not/exist/bar.sqlite3']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /não encontrado/);
  });
});

describe('history.mjs diff', () => {
  test('reports counts and added/removed ids per collection, comparing a version against the current state', () => {
    const { dir, dbPath } = buildTestDatabase([
      { version: 1, data: { consumers: [{ id: 'c1', name: 'Ana' }] } },
      { version: 1, data: { consumers: [{ id: 'c1', name: 'Ana' }, { id: 'c2', name: 'Bruno' }] } },
    ]);
    try {
      const result = runCli(['diff', '1', '--db', dbPath]);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /consumers/);
      assert.match(result.stdout, /1 ->\s*2/);
      assert.match(result.stdout, /\+1 novo/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('fails clearly for a seq that does not exist', () => {
    const { dir, dbPath } = buildTestDatabase([{ version: 1, data: {} }]);
    try {
      const result = runCli(['diff', '999', '--db', dbPath]);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /não encontrada/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('history.mjs restore', () => {
  test('rejects a missing/invalid seq argument before touching the database', () => {
    const { dir, dbPath } = buildTestDatabase([{ version: 1, data: {} }]);
    try {
      const result = runCli(['restore', 'not-a-number', '--db', dbPath, '--yes']);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /inválido/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('writes the target version back as the current state and records the restore itself as a new history entry', () => {
    const { dir, dbPath } = buildTestDatabase([
      { version: 1, data: { consumers: [{ id: 'c1' }] } },
      { version: 1, data: { consumers: [] } }, // seq 2 — the "mistake"
    ]);
    try {
      assert.equal(historyCount(dbPath), 2);

      const result = runCli(['restore', '1', '--db', dbPath, '--yes']);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /restaurado/);
      assert.match(result.stdout, /#3/); // the new history row this restore itself created

      const restored = JSON.parse(currentValue(dbPath));
      assert.deepEqual(restored.data.consumers, [{ id: 'c1' }]);
      // Restoring is undoable too: it is a new row, not a rewrite of #1 or #2.
      assert.equal(historyCount(dbPath), 3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('refuses to run while a lock file names a live process', () => {
    const { dir, dbPath } = buildTestDatabase([
      { version: 1, data: { consumers: [{ id: 'c1' }] } },
      { version: 1, data: { consumers: [] } },
    ]);
    try {
      // This test process's own pid is guaranteed alive for the duration
      // of this assertion — a real liveness check, not a guess.
      writeFileSync(
        `${dbPath}.lock`,
        JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
        'utf8',
      );

      const result = runCli(['restore', '1', '--db', dbPath, '--yes']);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /rodando/);
      // Nothing changed — the refusal happened before any write.
      const unchanged = JSON.parse(currentValue(dbPath));
      assert.deepEqual(unchanged.data.consumers, []);
      assert.equal(historyCount(dbPath), 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('proceeds, with a warning, when the lock file references a pid that is no longer alive', () => {
    const { dir, dbPath } = buildTestDatabase([
      { version: 1, data: { consumers: [{ id: 'c1' }] } },
      { version: 1, data: { consumers: [] } },
    ]);
    try {
      const dead = spawnSync(process.execPath, ['-e', '']);
      const deadPid = dead.pid;
      assert.ok(deadPid, 'failed to spawn a short-lived process for this test');
      writeFileSync(
        `${dbPath}.lock`,
        JSON.stringify({ pid: deadPid, startedAt: new Date().toISOString() }),
        'utf8',
      );

      const result = runCli(['restore', '1', '--db', dbPath, '--yes']);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stderr, /obsoleto/);
      const restored = JSON.parse(currentValue(dbPath));
      assert.deepEqual(restored.data.consumers, [{ id: 'c1' }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('fails with a clear message when the server bundle has not been built', () => {
    const { dir, dbPath } = buildTestDatabase([{ version: 1, data: {} }]);
    try {
      const result = runCli(['restore', '1', '--db', dbPath, '--yes'], {
        MOTOCLUB_HISTORY_BUNDLE_PATH: '/does/not/exist/server.mjs',
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /build:server/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('without --yes, cancelling at the confirmation prompt changes nothing', () => {
    const { dir, dbPath } = buildTestDatabase([
      { version: 1, data: { consumers: [{ id: 'c1' }] } },
      { version: 1, data: { consumers: [] } },
    ]);
    try {
      const result = spawnSync(process.execPath, [CLI_PATH, 'restore', '1', '--db', dbPath], {
        encoding: 'utf8',
        input: 'n\n',
      });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Cancelado/);
      assert.equal(historyCount(dbPath), 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
