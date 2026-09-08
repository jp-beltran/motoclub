import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { getHistoryStatus } from '../lib/history-status.mjs';

const CLI_PATH = fileURLToPath(new URL('../lib/history-status.mjs', import.meta.url));

function tmpDir() {
  return mkdtempSync(path.join(tmpdir(), 'motoclub-history-status-'));
}

function runCli(target) {
  return spawnSync(process.execPath, ['--no-warnings', CLI_PATH, target], { encoding: 'utf8' });
}

test('getHistoryStatus: arquivo inexistente -> tableExists false, count 0', () => {
  const status = getHistoryStatus('/caminho/que/nao/existe/banco.sqlite3');
  assert.equal(status.tableExists, false);
  assert.equal(status.count, 0);
  assert.equal(status.mostRecentWrittenAt, null);
});

test('getHistoryStatus: banco sem a tabela kv_history (schema antigo) -> tableExists false', () => {
  const dir = tmpDir();
  const dbPath = path.join(dir, 'sem-historico.sqlite3');
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)');
  db.close();

  const status = getHistoryStatus(dbPath);
  assert.equal(status.tableExists, false);
  assert.equal(status.count, 0);
});

test('getHistoryStatus: tabela existe mas vazia -> count 0, mostRecentWrittenAt null', () => {
  const dir = tmpDir();
  const dbPath = path.join(dir, 'vazio.sqlite3');
  const db = new DatabaseSync(dbPath);
  db.exec(
    'CREATE TABLE kv_history (seq INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL, value_gz BLOB NOT NULL, written_at TEXT NOT NULL)',
  );
  db.close();

  const status = getHistoryStatus(dbPath);
  assert.equal(status.tableExists, true);
  assert.equal(status.count, 0);
  assert.equal(status.mostRecentWrittenAt, null);
});

test('getHistoryStatus: conta as versões e acerta a mais recente (maior seq, não a última inserida)', () => {
  const dir = tmpDir();
  const dbPath = path.join(dir, 'com-historico.sqlite3');
  const db = new DatabaseSync(dbPath);
  db.exec(
    'CREATE TABLE kv_history (seq INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL, value_gz BLOB NOT NULL, written_at TEXT NOT NULL)',
  );
  const stmt = db.prepare('INSERT INTO kv_history (key, value_gz, written_at) VALUES (?, ?, ?)');
  stmt.run('motoclub:bar-database', Buffer.from('a'), '2026-01-01T04:00:00.000Z');
  stmt.run('motoclub:bar-database', Buffer.from('b'), '2026-01-02T04:00:00.000Z');
  stmt.run('motoclub:bar-database', Buffer.from('c'), '2026-01-03T04:00:00.000Z');
  db.close();

  const status = getHistoryStatus(dbPath);
  assert.equal(status.tableExists, true);
  assert.equal(status.count, 3);
  assert.equal(status.mostRecentWrittenAt, '2026-01-03T04:00:00.000Z');
});

test('CLI: imprime a linha no formato exists=/count=/mostRecent= esperado por doctor.sh', () => {
  const dir = tmpDir();
  const dbPath = path.join(dir, 'cli.sqlite3');
  const db = new DatabaseSync(dbPath);
  db.exec(
    'CREATE TABLE kv_history (seq INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL, value_gz BLOB NOT NULL, written_at TEXT NOT NULL)',
  );
  db.prepare('INSERT INTO kv_history (key, value_gz, written_at) VALUES (?, ?, ?)').run(
    'k',
    Buffer.from('x'),
    '2026-05-05T12:00:00.000Z',
  );
  db.close();

  const result = runCli(dbPath);
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), 'exists=1 count=1 mostRecent=2026-05-05T12:00:00.000Z');
});

test('CLI: banco sem a tabela imprime exists=0 count=0 mostRecent=-', () => {
  const dir = tmpDir();
  const dbPath = path.join(dir, 'sem-tabela.sqlite3');
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)');
  db.close();

  const result = runCli(dbPath);
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), 'exists=0 count=0 mostRecent=-');
});
