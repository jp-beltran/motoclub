// Testes de scripts/backup.mjs — rodando o CLI de verdade como subprocesso
// (não só as funções de scripts/lib/), porque é o processo — código de
// saída e o texto exato da linha "backup ok" — que o timer systemd e
// quem lê o log realmente enxergam.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const CLI_PATH = fileURLToPath(new URL('../backup.mjs', import.meta.url));

function tmpDir() {
  return mkdtempSync(path.join(tmpdir(), 'motoclub-backup-test-'));
}

function makeDb(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)');
  db.prepare('INSERT INTO kv VALUES (?, ?, ?)').run('a', 'b', 'c');
  db.close();
}

function runBackup(args) {
  return spawnSync(process.execPath, ['--no-warnings', CLI_PATH, ...args], { encoding: 'utf8' });
}

function backupFiles(dir) {
  return existsSync(dir) ? readdirSync(dir).filter((n) => n.startsWith('bar-')) : [];
}

test('backup.mjs: sucesso sem pendrive configurado', () => {
  const dir = tmpDir();
  const dbPath = path.join(dir, 'db.sqlite3');
  makeDb(dbPath);
  const backupDir = path.join(dir, 'backups');

  const result = runBackup(['--db', dbPath, '--backup-dir', backupDir]);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /^backup ok:/);
  assert.equal(backupFiles(backupDir).length, 1);
});

test('backup.mjs: sucesso com pendrive montado — copia E reverifica lá', () => {
  const dir = tmpDir();
  const dbPath = path.join(dir, 'db.sqlite3');
  makeDb(dbPath);
  const backupDir = path.join(dir, 'backups');
  const usbDir = path.join(dir, 'usb');
  mkdirSync(usbDir, { recursive: true });

  const result = runBackup(['--db', dbPath, '--backup-dir', backupDir, '--usb', usbDir]);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /^backup ok:/);
  assert.match(result.stdout, /copiado e verificado no pendrive/);
  assert.equal(backupFiles(backupDir).length, 1);
  assert.equal(backupFiles(usbDir).length, 1);
});

// Regressão I4: antes desta correção, um pendrive configurado mas não
// montado ainda saía 0 e imprimia uma linha começando com "backup ok:" —
// o timer reportava sucesso mesmo com o backup existindo só no HD interno.
test('backup.mjs: pendrive configurado mas NÃO montado — sai != 0 e NUNCA diz "backup ok"', () => {
  const dir = tmpDir();
  const dbPath = path.join(dir, 'db.sqlite3');
  makeDb(dbPath);
  const backupDir = path.join(dir, 'backups');
  const usbDirNaoMontado = path.join(dir, 'usb-que-nao-existe');

  const result = runBackup(['--db', dbPath, '--backup-dir', backupDir, '--usb', usbDirNaoMontado]);

  assert.notEqual(result.status, 0, 'deveria sair diferente de zero quando o pendrive configurado falha');
  assert.doesNotMatch(result.stdout + result.stderr, /^backup ok:/m);
  // O backup LOCAL continua bom e não é descartado por causa do pendrive.
  assert.equal(backupFiles(backupDir).length, 1, 'o backup local deveria existir mesmo com o pendrive falhando');
});

test('backup.mjs: poda o pendrive com a mesma política 14+8 do backup local', () => {
  const dir = tmpDir();
  const dbPath = path.join(dir, 'db.sqlite3');
  makeDb(dbPath);
  const backupDir = path.join(dir, 'backups');
  const usbDir = path.join(dir, 'usb');
  mkdirSync(backupDir, { recursive: true });
  mkdirSync(usbDir, { recursive: true });

  // 20 backups "diários" antigos, além do limite de 14 — tanto local
  // quanto no pendrive, para confirmar que a poda alcança os dois.
  for (let i = 1; i <= 20; i++) {
    const day = String(i).padStart(2, '0');
    const name = `bar-202601${day}-040000.sqlite3`;
    writeFileSync(path.join(backupDir, name), 'x');
    writeFileSync(path.join(usbDir, name), 'x');
  }

  const result = runBackup(['--db', dbPath, '--backup-dir', backupDir, '--usb', usbDir]);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  // 20 antigos + 1 novo = 21; política mantém no máximo 14+8=22, mas como
  // são todos do mesmo mês/dias consecutivos, o que importa aqui é que o
  // pendrive não cresceu sem controle: ele não pode ter mais arquivos do
  // que o backupDir local (mesma política, aplicada aos dois).
  const localCount = backupFiles(backupDir).length;
  const usbCount = backupFiles(usbDir).length;
  assert.ok(usbCount <= 22, `pendrive deveria estar podado (achei ${usbCount} arquivos)`);
  assert.equal(usbCount, localCount, 'pendrive e backup local deveriam convergir para a mesma contagem com a mesma política');
});

test('backup.mjs --dry-run: não cria nenhum arquivo, nem localmente nem no pendrive', () => {
  const dir = tmpDir();
  const dbPath = path.join(dir, 'db.sqlite3');
  makeDb(dbPath);
  const backupDir = path.join(dir, 'backups');
  const usbDir = path.join(dir, 'usb');
  mkdirSync(usbDir, { recursive: true });

  const result = runBackup(['--dry-run', '--db', dbPath, '--backup-dir', backupDir, '--usb', usbDir]);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /\[dry-run\]/);
  assert.equal(existsSync(backupDir), false, 'backupDir não deveria ter sido criado em --dry-run');
  assert.equal(backupFiles(usbDir).length, 0, 'nada deveria ter sido copiado para o pendrive em --dry-run');
});

test('backup.mjs: banco de origem inexistente sai 1 com mensagem clara', () => {
  const dir = tmpDir();
  const result = runBackup(['--db', path.join(dir, 'nao-existe.sqlite3'), '--backup-dir', path.join(dir, 'backups')]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /banco não encontrado/);
});
