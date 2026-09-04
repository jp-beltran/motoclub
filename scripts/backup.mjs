#!/usr/bin/env node
// scripts/backup.mjs — rodado por motoclub-backup.timer (04:00 diário) e também
// à mão para tirar um backup imediato.
//
// Regra inegociável: NUNCA copiar o arquivo .sqlite3 com cp. Em modo WAL os
// commits recentes moram no arquivo -wal ao lado do banco, e uma cópia crua
// perde exatamente os lançamentos mais novos, em silêncio. Por isso o backup
// é feito com `VACUUM INTO`, que consolida banco + WAL num arquivo único e
// consistente. Depois disso, o backup só é aceito como válido se
// `PRAGMA integrity_check` na cópia responder `ok` — um backup não verificado
// é boato, não backup.
//
// Uso:
//   node backup.mjs                 executa o backup de verdade
//   node backup.mjs --dry-run       só imprime o que faria, sem tocar em nada
//   node backup.mjs --db <path> --backup-dir <path> --usb <path>
//                                    substitui BAR_DB_PATH / diretório de
//                                    backups / pendrive (para testes)

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, statSync, unlinkSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { planPruning, parseBackupDate, formatBackupName } from './lib/prune-backups.mjs';
import { checkIntegrity } from './lib/sqlite-check.mjs';

function parseArgs(argv) {
  const args = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--db') args.db = argv[++i];
    else if (a === '--backup-dir') args.backupDir = argv[++i];
    else if (a === '--usb') args.usb = argv[++i];
    else {
      process.stderr.write(`argumento desconhecido: ${a}\n`);
      process.exit(2);
    }
  }
  return args;
}

function resolveConfig(args) {
  const home = os.homedir();
  const dbPath = args.db ?? process.env.BAR_DB_PATH ?? path.join(home, '.local', 'share', 'motoclub', 'bar.sqlite3');
  const backupDir = args.backupDir ?? process.env.BAR_BACKUP_DIR ?? path.join(home, 'Backups', 'motoclub');
  const usbPath = args.usb ?? process.env.BAR_BACKUP_USB_PATH ?? '';
  return { dbPath, backupDir, usbPath };
}

function listExistingBackups(backupDir) {
  if (!existsSync(backupDir)) return [];
  return readdirSync(backupDir)
    .map((name) => ({ name, date: parseBackupDate(name) }))
    .filter((b) => b.date !== null);
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { dbPath, backupDir, usbPath } = resolveConfig(args);
  const startedAt = Date.now();

  if (!existsSync(dbPath)) {
    process.stderr.write(`ERRO: banco não encontrado em ${dbPath}\n`);
    process.exitCode = 1;
    return;
  }

  const backupName = formatBackupName(new Date());
  const destPath = path.join(backupDir, backupName);
  const existing = listExistingBackups(backupDir);
  const { remove } = planPruning([...existing, { name: backupName, date: new Date() }], {
    dailyCount: 14,
    weeklyCount: 8,
  });

  if (args.dryRun) {
    console.log('[dry-run] backup.mjs não vai alterar nada. Plano:');
    console.log(`[dry-run] banco de origem: ${dbPath}`);
    console.log(`[dry-run] criaria (VACUUM INTO): ${destPath}`);
    console.log('[dry-run] rodaria PRAGMA integrity_check na cópia e exigiria "ok"');
    console.log(`[dry-run] backups existentes em ${backupDir}: ${existing.length}`);
    if (remove.length > 0) {
      console.log(`[dry-run] removeria ${remove.length} backup(s) fora da política (14 diários + 8 semanais): ${remove.join(', ')}`);
    } else {
      console.log('[dry-run] nenhum backup precisaria ser removido pela poda');
    }
    if (usbPath) {
      console.log(`[dry-run] copiaria o backup mais novo para o pendrive em ${usbPath}`);
    } else {
      console.log('[dry-run] nenhum pendrive configurado (BAR_BACKUP_USB_PATH) — copiaria só localmente');
    }
    return;
  }

  mkdirSync(backupDir, { recursive: true });

  const srcDb = new DatabaseSync(dbPath, { readOnly: true });
  try {
    srcDb.prepare('VACUUM INTO ?').run(destPath);
  } finally {
    srcDb.close();
  }

  const check = checkIntegrity(destPath);
  if (!check.ok) {
    // Backup não confiável: remove o arquivo ruim e falha alto e claro.
    try {
      unlinkSync(destPath);
    } catch {
      // segue o erro principal mesmo se a remoção falhar
    }
    process.stderr.write(`ERRO: integrity_check falhou (${check.detail}) — backup descartado\n`);
    process.exitCode = 1;
    return;
  }

  // Poda: recalcula com o arquivo real já no disco.
  const allBackups = listExistingBackups(backupDir);
  const { remove: toRemove } = planPruning(allBackups, { dailyCount: 14, weeklyCount: 8 });
  for (const name of toRemove) {
    try {
      rmSync(path.join(backupDir, name), { force: true });
    } catch (err) {
      process.stderr.write(`aviso: não consegui remover backup antigo ${name}: ${err.message}\n`);
    }
  }

  let usbNote = 'sem pendrive configurado';
  if (usbPath) {
    if (existsSync(usbPath)) {
      try {
        copyFileSync(destPath, path.join(usbPath, backupName));
        usbNote = `copiado para ${usbPath}`;
      } catch (err) {
        usbNote = `FALHOU ao copiar para o pendrive (${err.message})`;
      }
    } else {
      usbNote = `FALHOU: pendrive não está montado em ${usbPath}`;
    }
  }

  const size = statSync(destPath).size;
  const elapsedMs = Date.now() - startedAt;
  console.log(
    `backup ok: ${backupName} (${formatBytes(size)}, integrity_check=ok, ` +
      `podados ${toRemove.length}, ${usbNote}, ${elapsedMs}ms)`,
  );
}

main().catch((err) => {
  process.stderr.write(`ERRO inesperado no backup: ${err.stack || err.message}\n`);
  process.exitCode = 1;
});
