import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planPruning, isoWeekKey, parseBackupDate, formatBackupName } from '../lib/prune-backups.mjs';

function daysAgo(n, base = new Date('2026-09-03T04:00:00Z')) {
  const d = new Date(base.getTime());
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

test('mantém tudo quando há menos backups que o limite diário', () => {
  const backups = [0, 1, 2].map((n) => ({ name: `d${n}`, date: daysAgo(n) }));
  const { keep, remove } = planPruning(backups, { dailyCount: 14, weeklyCount: 8 });
  assert.equal(keep.length, 3);
  assert.equal(remove.length, 0);
});

test('mantém exatamente os 14 mais recentes como diários, sem semanais ainda', () => {
  const backups = Array.from({ length: 14 }, (_, n) => ({ name: `d${n}`, date: daysAgo(n) }));
  const { keep, remove } = planPruning(backups, { dailyCount: 14, weeklyCount: 8 });
  assert.equal(keep.length, 14);
  assert.equal(remove.length, 0);
  // o mais recente (d0) deve estar entre os mantidos
  assert.ok(keep.includes('d0'));
});

test('backups além dos 14 diários viram semanais, um por semana ISO, até o limite', () => {
  // 100 dias diários consecutivos: 14 diários + até 8 semanais devem sobrar de ~86 dias restantes
  const backups = Array.from({ length: 100 }, (_, n) => ({ name: `d${n}`, date: daysAgo(n) }));
  const { keep, remove } = planPruning(backups, { dailyCount: 14, weeklyCount: 8 });
  assert.equal(keep.length, 14 + 8);
  assert.equal(remove.length, 100 - (14 + 8));
  // os 14 mais recentes (d0..d13) sempre mantidos
  for (let i = 0; i < 14; i++) {
    assert.ok(keep.includes(`d${i}`), `d${i} deveria estar entre os diários mantidos`);
  }
});

test('nunca mantém mais que dailyCount + weeklyCount arquivos', () => {
  const backups = Array.from({ length: 365 }, (_, n) => ({ name: `d${n}`, date: daysAgo(n) }));
  const { keep } = planPruning(backups, { dailyCount: 14, weeklyCount: 8 });
  assert.ok(keep.length <= 22);
});

test('mantém apenas um backup por semana ISO entre os semanais', () => {
  // duas datas na mesma semana ISO, ambas fora da janela diária
  const base = new Date('2026-01-05T04:00:00Z'); // segunda-feira
  const sameWeekA = new Date(base.getTime());
  const sameWeekB = new Date(base.getTime());
  sameWeekB.setUTCDate(sameWeekB.getUTCDate() + 2); // quarta-feira, mesma semana ISO
  assert.equal(isoWeekKey(sameWeekA), isoWeekKey(sameWeekB));

  const backups = [
    { name: 'old-mon', date: sameWeekA },
    { name: 'old-wed', date: sameWeekB },
    // 14 diários recentes para empurrar os dois acima para fora da janela diária
    ...Array.from({ length: 14 }, (_, n) => ({ name: `recent${n}`, date: daysAgo(n) })),
  ];
  const { keep } = planPruning(backups, { dailyCount: 14, weeklyCount: 8 });
  const keptOld = keep.filter((n) => n === 'old-mon' || n === 'old-wed');
  assert.equal(keptOld.length, 1, 'só um dos dois backups da mesma semana ISO deve sobreviver');
});

test('parseBackupDate extrai a data de um nome válido (em hora LOCAL) e rejeita nomes inválidos', () => {
  // Acessores locais (getFullYear/getMonth/...), não UTC: formatBackupName
  // grava os dígitos em hora local, e reconstruir com Date.UTC() (como o
  // código fazia antes) introduzia um desvio de -03:00 toda vez que uma
  // data era lida de volta a partir do nome do arquivo.
  const d = parseBackupDate('bar-20260903-040000.sqlite3');
  assert.ok(d instanceof Date);
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 8); // setembro = índice 8
  assert.equal(d.getDate(), 3);
  assert.equal(d.getHours(), 4);
  assert.equal(d.getMinutes(), 0);
  assert.equal(d.getSeconds(), 0);
  assert.equal(parseBackupDate('lixo.sqlite3'), null);
  assert.equal(parseBackupDate('bar-2026-09-03.sqlite3'), null);
});

test('formatBackupName produz um nome que parseBackupDate lê de volta com os MESMOS valores locais', () => {
  const now = new Date(2026, 8, 3, 14, 5, 9); // horário local
  const name = formatBackupName(now);
  assert.match(name, /^bar-\d{8}-\d{6}\.sqlite3$/);

  // O round-trip real (formatar -> reler) precisa devolver a mesma data
  // local, não uma deslocada pelo fuso — é exatamente o bug que a
  // inconsistência UTC/local introduzia.
  const roundTripped = parseBackupDate(name);
  assert.equal(roundTripped.getFullYear(), now.getFullYear());
  assert.equal(roundTripped.getMonth(), now.getMonth());
  assert.equal(roundTripped.getDate(), now.getDate());
  assert.equal(roundTripped.getHours(), now.getHours());
  assert.equal(roundTripped.getMinutes(), now.getMinutes());
  assert.equal(roundTripped.getSeconds(), now.getSeconds());
});
