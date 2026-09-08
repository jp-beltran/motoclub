import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, openSync, writeSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { checkIntegrity } from '../lib/sqlite-check.mjs';

const CLI_PATH = fileURLToPath(new URL('../lib/sqlite-check.mjs', import.meta.url));

function tmpDir() {
  return mkdtempSync(path.join(tmpdir(), 'motoclub-sqlite-check-'));
}

function runCli(target) {
  return spawnSync(process.execPath, ['--no-warnings', CLI_PATH, target], { encoding: 'utf8' });
}

test('checkIntegrity retorna ok para um banco válido', () => {
  const dir = tmpDir();
  const dbPath = path.join(dir, 'ok.sqlite3');
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)');
  db.prepare('INSERT INTO kv VALUES (?, ?, ?)').run('a', 'b', 'c');
  db.close();

  const { ok, status, detail } = checkIntegrity(dbPath);
  assert.equal(ok, true);
  assert.equal(status, 'ok');
  assert.equal(detail, 'ok');
});

test('checkIntegrity retorna falso, status unverifiable, para arquivo inexistente', () => {
  // Arquivo ausente não é evidência de corrupção — é "nada para checar".
  // Quem chama isto (doctor.sh) não deve recomendar restauração só por
  // causa desse status, diferente de status 'corrupt'.
  const { ok, status, detail } = checkIntegrity('/caminho/que/nao/existe/banco.sqlite3');
  assert.equal(ok, false);
  assert.equal(status, 'unverifiable');
  assert.match(detail, /não existe/);
});

test('checkIntegrity retorna falso, status corrupt, para arquivo que não é SQLite', () => {
  const dir = tmpDir();
  const notDb = path.join(dir, 'nao-e-banco.sqlite3');
  writeFileSync(notDb, 'isto aqui não é um banco SQLite, é só texto qualquer que finge ser um arquivo de banco.');
  const { ok, status } = checkIntegrity(notDb);
  assert.equal(ok, false);
  assert.equal(status, 'corrupt');
});

test('checkIntegrity detecta corrupção de página em um banco antes válido', () => {
  const dir = tmpDir();
  const dbPath = path.join(dir, 'corrompido.sqlite3');
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)');
  const stmt = db.prepare('INSERT INTO kv VALUES (?, ?, ?)');
  // várias linhas para garantir mais de uma página
  for (let i = 0; i < 500; i++) {
    stmt.run(`chave-${i}`, `valor-bem-longo-para-ocupar-espaco-${'x'.repeat(200)}-${i}`, '2026-01-01');
  }
  db.close();

  // confirma que, antes de corromper, o banco é válido
  const before = checkIntegrity(dbPath);
  assert.equal(before.ok, true);

  // corrompe bytes bem depois do cabeçalho (que tem 100 bytes), no meio dos dados
  const fd = openSync(dbPath, 'r+');
  const garbage = Buffer.from('XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX');
  writeSync(fd, garbage, 0, garbage.length, 4096);
  closeSync(fd);

  const after = checkIntegrity(dbPath);
  assert.equal(after.ok, false, `esperava integrity_check falhar após corrupção, detalhe: ${after.detail}`);
  assert.equal(after.status, 'corrupt');
});

// --- CLI: os códigos de saída são o contrato de verdade para restore.sh e
// doctor.sh (chamam o binário, não a função) — testar a função sozinha não
// prova que o processo sai com o código certo.

test('CLI sai 0 e imprime "ok" para um banco válido', () => {
  const dir = tmpDir();
  const dbPath = path.join(dir, 'ok.sqlite3');
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)');
  db.close();

  const result = runCli(dbPath);
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), 'ok');
});

test('CLI sai 2 (distinto de "corrompido") para arquivo inexistente', () => {
  const result = runCli('/caminho/que/nao/existe/banco.sqlite3');
  assert.equal(result.status, 2);
  assert.match(result.stdout, /não existe/);
});

test('CLI sai 1 para um banco genuinamente corrompido', () => {
  const dir = tmpDir();
  const notDb = path.join(dir, 'nao-e-banco.sqlite3');
  writeFileSync(notDb, 'isto não é um banco SQLite de verdade.');

  const result = runCli(notDb);
  assert.equal(result.status, 1);
});
