import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { checkBarDocument } from '../lib/backup-content.mjs';

/**
 * Por que este arquivo existe, com data e hora: em 21/09/2026 o pendrive de
 * backup do clube tinha três arquivos. Os três passavam em
 * `PRAGMA integrity_check`. Um deles tinha ZERO linhas na tabela `kv` — foi
 * tirado na janela entre instalar e abrir o app pela primeira vez.
 *
 * Restaurar aquele arquivo teria devolvido um banco sem documento, e o
 * repositório, ao encontrar o armazenamento vazio, semeia a demonstração. Ou
 * seja: o operador restauraria "o backup" e receberia Ana Paula e Bruno
 * Santos de volta, sem nenhum erro na tela.
 *
 * integrity_check responde "este arquivo é um SQLite íntegro", não "seus dados
 * estão aqui". São perguntas diferentes, e só a segunda interessa a quem está
 * restaurando.
 */

const CHAVE = 'motoclub:bar-database';

function criarBanco(dir, nome, preencher) {
  const p = path.join(dir, nome);
  const db = new DatabaseSync(p);
  db.exec('CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)');
  if (preencher) preencher(db);
  db.close();
  return p;
}

function gravarDocumento(db, dados) {
  db.prepare('INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)')
    .run(CHAVE, JSON.stringify({ version: 1, data: dados }), new Date().toISOString());
}

const BAR_COM_MOVIMENTO = {
  consumers: [{ id: 'c1' }, { id: 'c2' }],
  items: [{ id: 'i1' }],
  events: [], tabs: [],
  consumptions: [{ id: 'x1' }, { id: 'x2' }, { id: 'x3' }],
  payments: [{ id: 'p1' }],
  stockMovements: [], monthlyClosings: [], memberStatements: [],
};

const BAR_VAZIO = {
  consumers: [], items: [], events: [], tabs: [], consumptions: [],
  payments: [], stockMovements: [], monthlyClosings: [], memberStatements: [],
};

describe('checkBarDocument', () => {
  let dir;
  test.beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'bkc-')); });
  test.afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  test('aprova um backup com o documento do bar, e resume o que tem dentro', () => {
    const p = criarBanco(dir, 'bom.sqlite3', (db) => gravarDocumento(db, BAR_COM_MOVIMENTO));

    const r = checkBarDocument(p);

    assert.equal(r.ok, true);
    assert.equal(r.resumo.consumers, 2);
    assert.equal(r.resumo.consumptions, 3);
    assert.equal(r.resumo.payments, 1);
  });

  test('aprova um bar legitimamente VAZIO — isso é um backup válido', () => {
    // O clube recém-limpo, antes do primeiro cadastro. Recusar aqui impediria
    // de fazer backup justamente do estado que o operador acabou de preparar.
    const p = criarBanco(dir, 'vazio.sqlite3', (db) => gravarDocumento(db, BAR_VAZIO));

    const r = checkBarDocument(p);

    assert.equal(r.ok, true);
    assert.equal(r.resumo.consumers, 0);
    assert.equal(r.vazio, true, 'precisa sinalizar que está vazio, para o operador reparar');
  });

  test('REPROVA o backup sem documento nenhum — o caso do pendrive', () => {
    const p = criarBanco(dir, 'sem-doc.sqlite3', null);

    const r = checkBarDocument(p);

    assert.equal(r.ok, false);
    assert.match(r.detail, /documento/i);
  });

  test('reprova documento que não é JSON', () => {
    const p = criarBanco(dir, 'lixo.sqlite3', (db) => {
      db.prepare('INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)')
        .run(CHAVE, 'isto não é json', new Date().toISOString());
    });

    const r = checkBarDocument(p);

    assert.equal(r.ok, false);
    assert.match(r.detail, /json/i);
  });

  test('reprova envelope sem o campo data', () => {
    const p = criarBanco(dir, 'sem-data.sqlite3', (db) => {
      db.prepare('INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)')
        .run(CHAVE, JSON.stringify({ version: 1 }), new Date().toISOString());
    });

    const r = checkBarDocument(p);

    assert.equal(r.ok, false);
  });

  test('reprova arquivo sem a tabela kv, sem explodir', () => {
    const p = path.join(dir, 'sem-kv.sqlite3');
    const db = new DatabaseSync(p);
    db.exec('CREATE TABLE outra (x TEXT)');
    db.close();

    const r = checkBarDocument(p);

    assert.equal(r.ok, false);
    assert.ok(r.detail.length > 0);
  });
});
