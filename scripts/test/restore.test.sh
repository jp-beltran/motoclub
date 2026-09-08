#!/usr/bin/env bash
# Teste de scripts/restore.sh — foco na regressão C2: swap_database_files
# precisa MOVER os sidecars -wal/-shm junto com o banco que está sendo
# trocado para o lado, nunca só apagá-los. Depois de uma parada suja
# (queda de energia, kill por timeout, crash-loop), o -wal pode guardar
# todo commit desde o último checkpoint — um `rm -f` ali destrói
# justamente o dado que a restauração existe para proteger.
#
# restore.sh é `source`ado, não executado (o guard no fim do arquivo
# garante isso) — o que permite chamar swap_database_files() sozinha,
# com arquivos de teste no lugar de um banco SQLite de verdade (esta
# função só move/copia arquivos, nunca olha o conteúdo).
#
# Uso: bash scripts/test/restore.test.sh
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# restore.sh roda `set -euo pipefail` assim que é lido — sourcing propaga
# isso para este shell também. Voltamos para um modo que deixa as
# asserções seguirem rodando depois de uma falhar.
# shellcheck source=../restore.sh
source "$SCRIPT_DIR/../restore.sh"
set +e
set -u

fail=0
total=0

check() {
  local desc="$1" ok="$2"
  total=$((total + 1))
  if [ "$ok" -eq 1 ]; then
    echo "  ok - $desc"
  else
    echo "  FALHOU - $desc"
    fail=$((fail + 1))
  fi
}

file_has() {
  # file_has <caminho> <conteúdo esperado> -> 1 (verdadeiro) ou 0
  local path="$1" expected="$2"
  if [ -f "$path" ] && [ "$(cat "$path" 2>/dev/null)" = "$expected" ]; then
    echo 1
  else
    echo 0
  fi
}

DRY_RUN=0

echo "swap_database_files: parada suja (banco + -wal + -shm existentes)"

TMP="$(mktemp -d)"
DB_PATH="$TMP/bar.sqlite3"
printf 'CONTEUDO-PRINCIPAL-ANTIGO' > "$DB_PATH"
printf 'CONTEUDO-WAL-COM-COMMITS-RECENTES' > "${DB_PATH}-wal"
printf 'CONTEUDO-SHM' > "${DB_PATH}-shm"

BACKUP_CANDIDATE="$TMP/backup-escolhido.sqlite3"
printf 'CONTEUDO-DO-BACKUP' > "$BACKUP_CANDIDATE"

swap_database_files "$BACKUP_CANDIDATE"

check "DB_PATH agora tem o conteúdo do backup escolhido" \
  "$(file_has "$DB_PATH" "CONTEUDO-DO-BACKUP")"

check "MOVED_ASIDE foi definido" "$([ -n "$MOVED_ASIDE" ] && echo 1 || echo 0)"

check "o banco ANTIGO foi preservado (não apagado) em MOVED_ASIDE" \
  "$(file_has "$MOVED_ASIDE" "CONTEUDO-PRINCIPAL-ANTIGO")"

# Este é o teste que pega a regressão C2: um `rm -f` no lugar do `mv`
# destruiria justamente os commits recentes que só existiam no -wal.
check "-wal ANTIGO foi MOVIDO junto (preservado, não apagado)" \
  "$(file_has "${MOVED_ASIDE}-wal" "CONTEUDO-WAL-COM-COMMITS-RECENTES")"

check "-shm ANTIGO foi movido junto (preservado, não apagado)" \
  "$(file_has "${MOVED_ASIDE}-shm" "CONTEUDO-SHM")"

check "não sobrou sidecar órfão no caminho original (DB_PATH-wal)" \
  "$([ ! -f "${DB_PATH}-wal" ] && echo 1 || echo 0)"

check "não sobrou sidecar órfão no caminho original (DB_PATH-shm)" \
  "$([ ! -f "${DB_PATH}-shm" ] && echo 1 || echo 0)"

rm -rf "$TMP"

echo
echo "swap_database_files: sem banco atual, só um -wal órfão (removido, não preservado)"

TMP2="$(mktemp -d)"
DB_PATH="$TMP2/bar.sqlite3"
printf 'WAL-ORFAO-SEM-BANCO' > "${DB_PATH}-wal"
BACKUP_CANDIDATE2="$TMP2/backup.sqlite3"
printf 'BACKUP2' > "$BACKUP_CANDIDATE2"

swap_database_files "$BACKUP_CANDIDATE2"

check "MOVED_ASIDE fica vazio quando não havia banco atual" \
  "$([ -z "$MOVED_ASIDE" ] && echo 1 || echo 0)"

check "backup foi copiado para DB_PATH mesmo sem banco atual" \
  "$(file_has "$DB_PATH" "BACKUP2")"

check "sidecar órfão (sem banco correspondente) foi removido" \
  "$([ ! -f "${DB_PATH}-wal" ] && echo 1 || echo 0)"

rm -rf "$TMP2"

echo
echo "swap_database_files: --dry-run não toca em nada"

TMP3="$(mktemp -d)"
DB_PATH="$TMP3/bar.sqlite3"
printf 'ORIGINAL' > "$DB_PATH"
printf 'WAL-ORIGINAL' > "${DB_PATH}-wal"
BACKUP_CANDIDATE3="$TMP3/backup.sqlite3"
printf 'BACKUP3' > "$BACKUP_CANDIDATE3"

DRY_RUN=1
swap_database_files "$BACKUP_CANDIDATE3"
DRY_RUN=0

check "--dry-run: DB_PATH original não foi tocado" \
  "$(file_has "$DB_PATH" "ORIGINAL")"
check "--dry-run: -wal original não foi tocado" \
  "$(file_has "${DB_PATH}-wal" "WAL-ORIGINAL")"

rm -rf "$TMP3"

echo
if [ "$fail" -eq 0 ]; then
  echo "OK: $total asserções passaram"
  exit 0
else
  echo "FALHA: $fail de $total asserções falharam"
  exit 1
fi
