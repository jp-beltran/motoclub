#!/usr/bin/env node
// scripts/history.mjs — histórico de versões do banco do bar e restauração
// de uma versão anterior (Fase 4 do plano: "um toque errado que estraga a
// comanda de uma noite vira restauração de uma linha").
//
// Por que um CLI, e não uma rota autenticada no app: o operador vai estar
// na máquina de qualquer forma para lidar com um erro sério o bastante
// para precisar disto, e uma rota exigiria autenticação, uma tela e testes
// de UI para uma ferramenta de manutenção que roda algumas vezes por
// evento, na melhor das hipóteses.
//
// `list` e `diff` abrem o banco em modo SOMENTE LEITURA (`readOnly: true`)
// e são seguros com o serviço no ar — múltiplos leitores em modo WAL não
// colidem com o processo que está escrevendo.
//
// `restore` ESCREVE no banco e por isso recusa rodar enquanto o serviço
// parecer estar de pé: um restore é uma escrita comum feita por fora do
// processo do servidor, e nada na camada do SQLite impede que ela colida
// com uma escrita do servidor no meio de um evento — a única coisa que
// evita essa corrida é o operador ter parado o serviço primeiro. Por isso
// `restore` importa `checkLockStatus`/`lockFilePath` do bundle já
// construído do servidor (`server/dist/server.mjs`) e recusa rodar quando
// esse lock aponta para um processo vivo (veja `main.ts`).
//
// `restore` também importa `SqliteStorage`/`openNodeSqliteDriver`/
// `SCHEMA_SQL` do mesmo bundle, em vez de reimplementar a escrita
// transacional (kv + kv_history + poda) em JavaScript solto: essa escrita
// já existe, já é testada, e duplicá-la aqui seria exatamente o tipo de
// "duas verdades que podem divergir" que este recurso existe para evitar.
// Consequência: `restore` só funciona depois de `npm run build:server` —
// que, na máquina de produção, já é uma pré-condição da Fase 1 (o notebook
// só recebe artefato, nunca compila).
//
// Uso:
//   node scripts/history.mjs list [--db <caminho>]
//   node scripts/history.mjs diff <seq> [--db <caminho>]
//   node scripts/history.mjs restore <seq> [--db <caminho>] [--yes]

import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { diffBarDatabases } from './lib/bar-history-diff.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
// Override exists mainly so tests can point this at a path that
// deliberately does not exist, without touching the real build artifact
// every other verification step (and other tests) depends on.
const BUNDLE_PATH =
  process.env.MOTOCLUB_HISTORY_BUNDLE_PATH ?? path.join(SCRIPT_DIR, '..', 'server', 'dist', 'server.mjs');

class CliError extends Error {}

function fail(message) {
  throw new CliError(message);
}

function say(message) {
  console.log(message);
}

function warn(message) {
  console.error(`aviso: ${message}`);
}

function ok(message) {
  console.log(`✓ ${message}`);
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// --- resolução do caminho do banco (mesma convenção de restore.sh/doctor.sh) --

function readEnvFileVar(file, name) {
  if (!existsSync(file)) return undefined;
  const content = readFileSync(file, 'utf8');
  for (const line of content.split('\n')) {
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    if (line.slice(0, eq) === name) return line.slice(eq + 1).trim();
  }
  return undefined;
}

function resolveDbPath(override) {
  if (override) return override;
  const home = os.homedir();
  const envFile = process.env.MOTOCLUB_ENV_FILE ?? path.join(home, '.config', 'motoclub', 'env');
  const fromFile = readEnvFileVar(envFile, 'BAR_DB_PATH');
  return fromFile || process.env.BAR_DB_PATH || path.join(home, '.local', 'share', 'motoclub', 'bar.sqlite3');
}

// --- leituras somente-leitura, sem depender do bundle do servidor ------------

function requireDbFile(dbPath) {
  if (!existsSync(dbPath)) fail(`banco não encontrado em ${dbPath}`);
}

function listHistory(dbPath) {
  requireDbFile(dbPath);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db
      .prepare('SELECT seq, key, written_at, length(value_gz) as size_bytes FROM kv_history ORDER BY seq DESC')
      .all();
  } finally {
    db.close();
  }
}

function readCurrentValue(dbPath, key) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key);
    return row ? row.value : undefined;
  } finally {
    db.close();
  }
}

function readHistoryEntry(dbPath, seq) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const row = db.prepare('SELECT key, value_gz, written_at FROM kv_history WHERE seq = ?').get(seq);
    if (!row) return undefined;
    return { key: row.key, writtenAt: row.written_at, value: gunzipSync(row.value_gz).toString('utf8') };
  } finally {
    db.close();
  }
}

function parseEnvelope(raw, label) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    fail(`${label} não é JSON válido depois de descomprimir: ${err.message}`);
  }
  if (typeof parsed !== 'object' || parsed === null || typeof parsed.data !== 'object' || parsed.data === null) {
    fail(`${label} não tem o formato esperado ({version, data}) — recusando.`);
  }
  return parsed;
}

// --- formatação -------------------------------------------------------------

function printDiffTable(collections) {
  for (const c of collections) {
    const delta = c.after - c.before;
    const deltaStr = delta > 0 ? `+${delta}` : `${delta}`;
    const notes = [];
    if (c.added.length > 0) notes.push(`+${c.added.length} novo(s)`);
    if (c.removed.length > 0) notes.push(`-${c.removed.length} removido(s)`);
    if (c.changed.length > 0) notes.push(`${c.changed.length} alterado(s)`);
    const suffix = notes.length > 0 ? ` — ${notes.join(', ')}` : ' — sem mudança';
    say(`  ${c.name.padEnd(17)} ${String(c.before).padStart(5)} -> ${String(c.after).padStart(5)} (${deltaStr})${suffix}`);
  }
}

// --- comandos ----------------------------------------------------------------

function cmdList(dbPath) {
  const rows = listHistory(dbPath);
  if (rows.length === 0) {
    say(`nenhuma versão no histórico ainda em ${dbPath}`);
    return;
  }
  say(`Histórico de versões em ${dbPath} (mais recente primeiro):`);
  for (const row of rows) {
    say(`  [#${row.seq}] ${row.written_at} — ${formatBytes(row.size_bytes)} — chave '${row.key}'`);
  }
}

function cmdDiff(dbPath, seq) {
  requireDbFile(dbPath);
  const entry = readHistoryEntry(dbPath, seq);
  if (!entry) fail(`versão #${seq} não encontrada em ${dbPath} (veja 'list' para os números válidos)`);
  const target = parseEnvelope(entry.value, `versão #${seq}`);

  const currentRaw = readCurrentValue(dbPath, entry.key);
  if (currentRaw === undefined) fail(`chave '${entry.key}' não existe no estado atual do banco`);
  const current = parseEnvelope(currentRaw, 'estado atual');

  say(`Comparando versão #${seq} (${entry.writtenAt}) com o estado atual:`);
  printDiffTable(diffBarDatabases(target.data, current.data).collections);
}

async function confirm(promptText) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(promptText);
    return /^s(im)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

async function loadServerBundle() {
  if (!existsSync(BUNDLE_PATH)) {
    fail(
      `'restore' precisa do bundle do servidor (${BUNDLE_PATH}), que não existe. ` +
        "Rode 'npm run build:server' primeiro — a escrita é feita através do mesmo " +
        'código do servidor, de propósito, em vez de duplicado aqui.',
    );
  }
  return import(pathToFileURL(BUNDLE_PATH).href);
}

async function cmdRestore(dbPath, seq, { yes }) {
  requireDbFile(dbPath);
  const { checkLockStatus, lockFilePath, openNodeSqliteDriver, SCHEMA_SQL, SqliteStorage } = await loadServerBundle();

  const status = checkLockStatus(dbPath);
  if (status.running) {
    fail(
      `o serviço parece estar rodando (pid ${status.pid}, lock em ${lockFilePath(dbPath)}) — ` +
        "pare com 'systemctl --user stop motoclub' antes de restaurar.",
    );
  }
  if (status.stale) {
    warn(
      `lock em ${lockFilePath(dbPath)} referencia o pid ${status.pid}, que não está mais rodando ` +
        '— tratando como obsoleto (um processo anterior deve ter caído sem limpar) e prosseguindo.',
    );
  }

  const entry = readHistoryEntry(dbPath, seq);
  if (!entry) fail(`versão #${seq} não encontrada em ${dbPath} (veja 'list' para os números válidos)`);
  parseEnvelope(entry.value, `versão #${seq}`); // valida antes de perguntar/escrever

  const currentRaw = readCurrentValue(dbPath, entry.key);
  if (currentRaw !== undefined) {
    const current = parseEnvelope(currentRaw, 'estado atual');
    const target = parseEnvelope(entry.value, `versão #${seq}`);
    say('O que vai mudar (estado atual -> versão escolhida):');
    printDiffTable(diffBarDatabases(current.data, target.data).collections);
  }

  if (!yes) {
    const confirmed = await confirm(
      `Restaurar a versão #${seq} (${entry.writtenAt})? Isso é registrado como uma NOVA entrada no ` +
        'histórico — nada é apagado, e este próprio restore pode ser desfeito depois. [s/N] ',
    );
    if (!confirmed) {
      say('Cancelado. Nada foi alterado.');
      return;
    }
  }

  const driver = await openNodeSqliteDriver(dbPath);
  try {
    driver.exec(SCHEMA_SQL);
    new SqliteStorage(driver).setItem(entry.key, entry.value);
    const newest = driver.get('SELECT seq, written_at FROM kv_history ORDER BY seq DESC LIMIT 1');
    ok(
      `restaurado: a versão #${seq} agora é o estado atual, registrado como a nova entrada ` +
        `#${newest?.seq} (${newest?.written_at}) do histórico.`,
    );
  } finally {
    driver.close();
  }
}

// --- CLI ----------------------------------------------------------------------

function usage() {
  say(`Uso:
  node scripts/history.mjs list [--db <caminho>]
  node scripts/history.mjs diff <seq> [--db <caminho>]
  node scripts/history.mjs restore <seq> [--db <caminho>] [--yes]

list/diff leem o banco em modo somente-leitura e são seguros com o serviço no ar.
restore ESCREVE no banco: recusa rodar enquanto 'motoclub.service' parecer ativo
(veja o lock em <banco>.lock) — pare o serviço primeiro.`);
}

function parseArgs(argv) {
  const positional = [];
  let dbOverride;
  let yes = false;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--db') dbOverride = argv[(i += 1)];
    else if (a === '--yes') yes = true;
    else positional.push(a);
  }
  return { positional, dbOverride, yes };
}

function parseSeq(value) {
  const n = Number(value);
  if (!value || !Number.isInteger(n) || n <= 0) {
    fail(`número de versão inválido: ${JSON.stringify(value)} (esperado um inteiro positivo — veja 'list')`);
  }
  return n;
}

async function main() {
  const { positional, dbOverride, yes } = parseArgs(process.argv.slice(2));
  const command = positional[0];

  if (!command || command === '-h' || command === '--help') {
    usage();
    return;
  }

  const dbPath = resolveDbPath(dbOverride);

  if (command === 'list') {
    cmdList(dbPath);
    return;
  }
  if (command === 'diff') {
    cmdDiff(dbPath, parseSeq(positional[1]));
    return;
  }
  if (command === 'restore') {
    await cmdRestore(dbPath, parseSeq(positional[1]), { yes });
    return;
  }

  fail(`comando desconhecido: ${command}`);
}

main().catch((err) => {
  if (err instanceof CliError) {
    console.error(`ERRO: ${err.message}`);
  } else {
    console.error(`ERRO inesperado: ${err.stack || err.message}`);
  }
  process.exitCode = 1;
});
