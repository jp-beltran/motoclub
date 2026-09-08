#!/usr/bin/env bash
# Testes das funções puras de scripts/lib/version.sh.
# Uso: bash scripts/test/version.test.sh
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/version.sh
source "$SCRIPT_DIR/../lib/version.sh"

fail=0
total=0

assert_true() {
  local desc="$1"
  shift
  total=$((total + 1))
  if "$@"; then
    echo "  ok - $desc"
  else
    echo "  FALHOU - $desc (esperava verdadeiro: $*)"
    fail=$((fail + 1))
  fi
}

assert_false() {
  local desc="$1"
  shift
  total=$((total + 1))
  if ! "$@"; then
    echo "  ok - $desc"
  else
    echo "  FALHOU - $desc (esperava falso: $*)"
    fail=$((fail + 1))
  fi
}

assert_eq() {
  local desc="$1" expected="$2" actual="$3"
  total=$((total + 1))
  if [ "$expected" = "$actual" ]; then
    echo "  ok - $desc"
  else
    echo "  FALHOU - $desc (esperava '$expected', obteve '$actual')"
    fail=$((fail + 1))
  fi
}

echo "version_ge"
assert_true "2.39 >= 2.28" version_ge "2.39" "2.28"
assert_true "22.0.0 >= 22" version_ge "22.0.0" "22"
assert_true "22.11.0 >= 22.11.0 (igual)" version_ge "22.11.0" "22.11.0"
assert_false "2.27 >= 2.28 é falso" version_ge "2.27" "2.28"
assert_true "3.0 >= 2.99" version_ge "3.0" "2.99"
assert_true "2.28.1 >= 2.28" version_ge "2.28.1" "2.28"
assert_false "2.9 >= 2.10 é falso (comparação numérica, não lexicográfica)" version_ge "2.9" "2.10"
assert_true "2.10 >= 2.9" version_ge "2.10" "2.9"

echo "strip_v"
assert_eq "remove o v de v22.11.0" "22.11.0" "$(strip_v v22.11.0)"
assert_eq "não mexe quando já não tem v" "22.11.0" "$(strip_v 22.11.0)"

echo "node_major"
assert_eq "major de v22.11.0" "22" "$(node_major v22.11.0)"
assert_eq "major de 20.5.1" "20" "$(node_major 20.5.1)"

echo "node_version_ok"
assert_true "22.11.0 satisfaz mínimo 22" node_version_ok "v22.11.0" "22"
assert_true "24.0.0 satisfaz mínimo 22" node_version_ok "v24.0.0" "22"
assert_false "20.5.0 não satisfaz mínimo 22" node_version_ok "v20.5.0" "22"
assert_false "string vazia (node ausente) não satisfaz" node_version_ok "" "22"

echo "parse_glibc_version"
assert_eq "extrai versão do formato Ubuntu" "2.39" "$(parse_glibc_version 'ldd (Ubuntu GLIBC 2.39-0ubuntu8.3) 2.39')"
assert_eq "extrai versão simples" "2.28" "$(parse_glibc_version 'ldd (GNU libc) 2.28')"

echo "node_version_ge"
assert_true "22.11.0 >= 22.5.0" node_version_ge "v22.11.0" "22.5.0"
assert_true "22.5.0 >= 22.5.0 (igual)" node_version_ge "v22.5.0" "22.5.0"
assert_false "22.4.9 >= 22.5.0 é falso (abaixo do mínimo do node:sqlite)" node_version_ge "v22.4.9" "22.5.0"
assert_false "20.18.0 >= 22.5.0 é falso" node_version_ge "v20.18.0" "22.5.0"
assert_true "24.0.0 >= 22.5.0" node_version_ge "v24.0.0" "22.5.0"
assert_false "string vazia (node ausente) não satisfaz" node_version_ge "" "22.5.0"

echo
if [ "$fail" -eq 0 ]; then
  echo "OK: $total asserções passaram"
  exit 0
else
  echo "FALHA: $fail de $total asserções falharam"
  exit 1
fi
