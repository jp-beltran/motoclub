#!/usr/bin/env node
// Verificação de integridade de um arquivo SQLite, compartilhada por
// backup.mjs, restore.sh e doctor.sh — para todo mundo exigir exatamente
// o mesmo critério ("ok" e só "ok"), em vez de reimplementar a checagem
// em cada script.

import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';

/**
 * `status` distingue duas coisas que "ok: false" sozinho confundia:
 *   - 'unverifiable': não tem o que checar (arquivo não existe). Não é
 *     evidência de corrupção — quem chama isto não deve recomendar
 *     restaurar um backup por causa disto sozinho.
 *   - 'corrupt': o arquivo existe, foi possível tentar abrir/checar, e o
 *     resultado é negativo (não abriu como SQLite, ou PRAGMA
 *     integrity_check relatou problema). Isto sim é motivo para restaurar.
 *
 * @param {string} sqlitePath
 * @returns {{ok: boolean, status: 'ok'|'corrupt'|'unverifiable', detail: string}}
 */
export function checkIntegrity(sqlitePath) {
  if (!existsSync(sqlitePath)) {
    return { ok: false, status: 'unverifiable', detail: 'arquivo não existe' };
  }
  let db;
  try {
    db = new DatabaseSync(sqlitePath, { readOnly: true });
  } catch (err) {
    return { ok: false, status: 'corrupt', detail: `não abriu como SQLite: ${err.message}` };
  }
  try {
    const rows = db.prepare('PRAGMA integrity_check').all();
    const results = rows.map((r) => r.integrity_check);
    const ok = results.length === 1 && results[0] === 'ok';
    return { ok, status: ok ? 'ok' : 'corrupt', detail: results.join('; ') };
  } catch (err) {
    return { ok: false, status: 'corrupt', detail: `erro ao checar: ${err.message}` };
  } finally {
    db.close();
  }
}

// --- CLI -----------------------------------------------------------------
// Uso: node sqlite-check.mjs <caminho.sqlite3>
// Imprime "ok" e sai 0 se íntegro; sai 1 se corrompido (detalhe impresso);
// sai 2 se não deu para verificar (ex.: arquivo não existe) — código
// diferente de propósito, para quem chama não recomendar restauração só
// porque não havia nada para checar.
// Pensado para ser chamado de dentro de scripts bash (restore.sh, doctor.sh).

function main() {
  const target = process.argv[2];
  if (!target) {
    process.stderr.write('uso: sqlite-check.mjs <caminho.sqlite3>\n');
    process.exitCode = 2;
    return;
  }
  const { ok, status, detail } = checkIntegrity(target);
  if (ok) {
    process.stdout.write('ok\n');
    process.exitCode = 0;
    return;
  }
  process.stdout.write(`${detail}\n`);
  process.exitCode = status === 'unverifiable' ? 2 : 1;
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main();
}
