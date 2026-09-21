#!/usr/bin/env bash
# Testes de scripts/lib/node-sqlite.mjs — a recuperação quando o Node que
# rodou o script não tem node:sqlite.
#
# Por que existe: o operador roda `node scripts/limpar-banco.mjs` na mão, e o
# Node do PATH do Mint não serve (ou não existe). Sem esta recuperação, ele
# recebe `ERR_UNKNOWN_BUILTIN_MODULE`, que não diz nada sobre o que fazer —
# aconteceu de verdade, no notebook do clube, na hora de limpar o banco.
#
# Uso: bash scripts/test/node-sqlite.test.sh
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

fail=0
total=0

assert_contains() {
  local desc="$1" needle="$2" haystack="$3"
  total=$((total + 1))
  if [[ "$haystack" == *"$needle"* ]]; then
    echo "  ok - $desc"
  else
    echo "  FALHOU - $desc"
    echo "      esperava: [$needle]"
    printf '%s\n' "$haystack" | sed 's/^/        /'
    fail=$((fail + 1))
  fi
}

assert_eq() {
  local desc="$1" esperado="$2" obtido="$3"
  total=$((total + 1))
  if [ "$esperado" = "$obtido" ]; then
    echo "  ok - $desc"
  else
    echo "  FALHOU - $desc (esperado [$esperado], obtido [$obtido])"
    fail=$((fail + 1))
  fi
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Um script mínimo que só carrega o módulo e diz que conseguiu.
cat > "$TMP/usa-sqlite.mjs" <<'MJS'
import { carregarSqlite } from './node-sqlite.mjs'
const { DatabaseSync } = await carregarSqlite()
console.log(typeof DatabaseSync === 'function' ? 'CARREGOU' : 'NAO CARREGOU')
MJS
cp "$REPO_ROOT/scripts/lib/node-sqlite.mjs" "$TMP/node-sqlite.mjs"

echo
echo "sem recuperação necessária: o Node atual já tem node:sqlite"
saida="$(node "$TMP/usa-sqlite.mjs" 2>&1)"
assert_contains "carrega direto" "CARREGOU" "$saida"

echo
echo "Node sem node:sqlite e NENHUM candidato: explica, e nomeia o comando certo"
saida="$(MOTOCLUB_FINGIR_SEM_SQLITE=1 MOTOCLUB_NODE_CANDIDATOS=/nao/existe \
  node "$TMP/usa-sqlite.mjs" 2>&1)"
codigo=$?
assert_contains "diz que não achou Node adequado" "não achei um Node" "$saida"
assert_contains "explica a versão mínima" "22.5" "$saida"
assert_contains "ensina o caminho do instalador" "/opt/node/bin/node" "$saida"
assert_contains "não vaza o erro cru do Node" "install.sh" "$saida"
total=$((total + 1))
if [[ "$saida" != *"ERR_UNKNOWN_BUILTIN_MODULE"* ]]; then
  echo "  ok - não mostra ERR_UNKNOWN_BUILTIN_MODULE ao operador"
else
  echo "  FALHOU - o erro críptico vazou para a saída"
  fail=$((fail + 1))
fi

echo
echo "Node sem node:sqlite, mas COM candidato: reexecuta e funciona"
# O seam não é propagado ao filho, então o filho carrega de verdade.
saida="$(MOTOCLUB_FINGIR_SEM_SQLITE=1 MOTOCLUB_NODE_CANDIDATOS="$(command -v node)" \
  node "$TMP/usa-sqlite.mjs" 2>&1)"
assert_contains "o trabalho acontece, pelo Node certo" "CARREGOU" "$saida"

echo
echo "guarda contra laço: se o candidato também não servir, para em vez de reexecutar sempre"
saida="$(MOTOCLUB_FINGIR_SEM_SQLITE=1 MOTOCLUB_NODE_REEXEC=1 \
  MOTOCLUB_NODE_CANDIDATOS="$(command -v node)" node "$TMP/usa-sqlite.mjs" 2>&1)"
assert_contains "reconhece a segunda tentativa" "segunda tentativa" "$saida"

echo
if [ "$fail" -eq 0 ]; then
  echo "OK: $total asserções passaram"
  exit 0
fi
echo "FALHOU: $fail de $total asserções"
exit 1
