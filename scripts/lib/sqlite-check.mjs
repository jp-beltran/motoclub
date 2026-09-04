#!/usr/bin/env node
// Verificação de integridade de um arquivo SQLite, compartilhada por
// backup.mjs, restore.sh e doctor.sh — para todo mundo exigir exatamente
// o mesmo critério ("ok" e só "ok"), em vez de reimplementar a checagem
// em cada script.

import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';

/**
 * @param {string} sqlitePath
 * @returns {{ok: boolean, detail: string}}
 */
export function checkIntegrity(sqlitePath) {
  if (!existsSync(sqlitePath)) {
    return { ok: false, detail: 'arquivo não existe' };
  }
  let db;
  try {
    db = new DatabaseSync(sqlitePath, { readOnly: true });
  } catch (err) {
    return { ok: false, detail: `não abriu como SQLite: ${err.message}` };
  }
  try {
    const rows = db.prepare('PRAGMA integrity_check').all();
    const results = rows.map((r) => r.integrity_check);
    const ok = results.length === 1 && results[0] === 'ok';
    return { ok, detail: results.join('; ') };
  } catch (err) {
    return { ok: false, detail: `erro ao checar: ${err.message}` };
  } finally {
    db.close();
  }
}

// --- CLI -----------------------------------------------------------------
// Uso: node sqlite-check.mjs <caminho.sqlite3>
// Imprime "ok" e sai 0 se íntegro; senão imprime o detalhe e sai 1.
// Pensado para ser chamado de dentro de scripts bash (restore.sh, doctor.sh).

function main() {
  const target = process.argv[2];
  if (!target) {
    process.stderr.write('uso: sqlite-check.mjs <caminho.sqlite3>\n');
    process.exitCode = 2;
    return;
  }
  const { ok, detail } = checkIntegrity(target);
  if (ok) {
    process.stdout.write('ok\n');
    process.exitCode = 0;
  } else {
    process.stdout.write(`${detail}\n`);
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main();
}
