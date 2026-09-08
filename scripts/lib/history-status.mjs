#!/usr/bin/env node
// scripts/lib/history-status.mjs — resume o estado do histórico de versões
// (tabela kv_history) para o doctor.sh poder reportar sobre ele.
//
// kv_history é escrita pelo servidor (na mesma transação de cada gravação
// em kv) e lida/restaurada por scripts/history.mjs — este arquivo não
// duplica nenhuma dessas escritas, só lê o que já existe, somente leitura,
// para diagnóstico. Sem este check, um operador debugando uma noite
// perdida ("apaguei uma comanda sem querer") não tem como descobrir, pelo
// doctor.sh, que existe uma forma de desfazer isso.

import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';

/**
 * @param {string} sqlitePath
 * @returns {{tableExists: boolean, count: number, mostRecentWrittenAt: string|null}}
 */
export function getHistoryStatus(sqlitePath) {
  if (!existsSync(sqlitePath)) {
    return { tableExists: false, count: 0, mostRecentWrittenAt: null };
  }
  const db = new DatabaseSync(sqlitePath, { readOnly: true });
  try {
    const tableRow = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'kv_history'").get();
    if (!tableRow) {
      return { tableExists: false, count: 0, mostRecentWrittenAt: null };
    }
    const countRow = db.prepare('SELECT COUNT(*) as n FROM kv_history').get();
    const mostRecentRow = db.prepare('SELECT written_at FROM kv_history ORDER BY seq DESC LIMIT 1').get();
    return {
      tableExists: true,
      count: countRow ? Number(countRow.n) : 0,
      mostRecentWrittenAt: mostRecentRow ? mostRecentRow.written_at : null,
    };
  } finally {
    db.close();
  }
}

// --- CLI -----------------------------------------------------------------
// Uso: node history-status.mjs <caminho.sqlite3>
// Imprime uma linha "exists=<0|1> count=<n> mostRecent=<iso|->" — formato
// fácil de recortar com grep/cut de dentro de doctor.sh (bash), em vez de
// tentar parsear JSON num script shell.

function main() {
  const target = process.argv[2];
  if (!target) {
    process.stderr.write('uso: history-status.mjs <caminho.sqlite3>\n');
    process.exitCode = 2;
    return;
  }
  const { tableExists, count, mostRecentWrittenAt } = getHistoryStatus(target);
  process.stdout.write(`exists=${tableExists ? 1 : 0} count=${count} mostRecent=${mostRecentWrittenAt ?? '-'}\n`);
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main();
}
