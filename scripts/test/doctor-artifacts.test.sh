#!/usr/bin/env bash
# Testes da seção "Artefatos de build" do doctor.sh — em especial o
# relato de QUAL build está instalado.
#
# Por que isto merece teste próprio: o fluxo de atualização do notebook é
# 'git pull && systemctl --user restart motoclub'. Se o doctor.sh não
# disser qual commit está instalado, "atualizei e o problema continua"
# fica indistinguível de "o pull não pegou" — e essa dúvida é justamente
# o que faz alguém reinstalar tudo às 23h.
#
# Uso: bash scripts/test/doctor-artifacts.test.sh
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
    echo "      esperava encontrar: [$needle]"
    echo "      na saída:"
    printf '%s\n' "$haystack" | sed 's/^/        /'
    fail=$((fail + 1))
  fi
}

assert_not_contains() {
  local desc="$1" needle="$2" haystack="$3"
  total=$((total + 1))
  if [[ "$haystack" != *"$needle"* ]]; then
    echo "  ok - $desc"
  else
    echo "  FALHOU - $desc"
    echo "      NÃO esperava encontrar: [$needle]"
    fail=$((fail + 1))
  fi
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Um "checkout" mínimo com os artefatos que o doctor.sh procura. Não
# copiamos o repo inteiro: só o que esta seção lê.
HOME_DIR="$TMP/motoclub"
mkdir -p "$HOME_DIR/dist" "$HOME_DIR/server/dist" "$HOME_DIR/scripts/lib"
echo '<div id="root"></div>' > "$HOME_DIR/dist/index.html"
echo 'console.log("bundle")' > "$HOME_DIR/server/dist/server.mjs"
cp "$REPO_ROOT/scripts/doctor.sh" "$HOME_DIR/scripts/"
cp "$REPO_ROOT"/scripts/lib/*.sh "$REPO_ROOT"/scripts/lib/*.mjs "$HOME_DIR/scripts/lib/"

secao_artefatos() {
  MOTOCLUB_HOME_DIR="$HOME_DIR" \
  MOTOCLUB_CONFIG_DIR="$TMP/config" \
  MOTOCLUB_ENV_FILE="$TMP/config/env" \
  BAR_DB_PATH="$TMP/data/bar.sqlite3" \
  BAR_BACKUP_DIR="$TMP/backups" \
  MOTOCLUB_SYSTEMD_USER_DIR="$TMP/systemd" \
  MOTOCLUB_NODE_INSTALL_ROOT="$TMP/node" \
  MOTOCLUB_LOGIND_DROPIN_DIR="$TMP/logind" \
    bash "$HOME_DIR/scripts/doctor.sh" 2>/dev/null \
    | sed -n '/== Artefatos de build/,/^$/p'
}

echo
echo "sem producao-info.json: avisa, mas não reprova (checkout de fonte é legítimo)"
saida="$(secao_artefatos)"
assert_contains "confirma que os artefatos existem" \
  "dist/index.html e server/dist/server.mjs presentes" "$saida"
assert_contains "avisa que não sabe qual build é" "não dá para dizer qual build está instalado" "$saida"
assert_not_contains "não reprova por isso" "FALHOU" "$saida"

echo
echo "com producao-info.json coerente: diz o commit e a data"
cat > "$HOME_DIR/producao-info.json" <<'JSON'
{
  "sourceRef": "feat/prototipo-bar",
  "sourceCommit": "9c653ad7317c87664fbfbfeb7fbe453992f7dd9d",
  "builtAt": "2026-09-08T18:13:13-03:00",
  "nodeVersion": "v24.12.0"
}
JSON
git_local() { git -C "$HOME_DIR" -c user.email=t@t -c user.name=teste "$@"; }
git_local init -q
git_local add -A >/dev/null 2>&1
git_local commit -qm "artefatos publicados" >/dev/null 2>&1
# Datas separadas por milissegundos, na ordem em que um checkout grava —
# era exatamente isto que fazia a versão por mtime avisar sempre.
touch "$HOME_DIR/server/dist/server.mjs"
saida="$(secao_artefatos)"
assert_contains "informa o commit instalado" "build instalado: 9c653ad73" "$saida"
assert_contains "informa quando foi compilado" "2026-09-08T18:13:13-03:00" "$saida"
assert_contains "confirma que o artefato é o do commit" "artefatos idênticos ao commit" "$saida"
assert_not_contains "NÃO avisa só porque o mtime é mais novo (o falso positivo)" "diferem do commit" "$saida"

echo
echo "bundle recompilado por cima do publicado: avisa que o commit informado não é o que roda"
echo 'console.log("bundle compilado a mao")' > "$HOME_DIR/server/dist/server.mjs"
saida="$(secao_artefatos)"
assert_contains "detecta o artefato alterado" "diferem do commit" "$saida"
assert_contains "explica que o que roda é o arquivo em disco" "o que roda é o arquivo em disco" "$saida"
assert_contains "ensina como voltar ao publicado" "checkout -- dist server/dist" "$saida"
git_local checkout -q -- server/dist

echo
echo "producao-info.json corrompido: avisa em vez de imprimir campo vazio"
echo 'isto nao e json' > "$HOME_DIR/producao-info.json"
saida="$(secao_artefatos)"
assert_contains "avisa que não conseguiu ler o sourceCommit" "não tem sourceCommit legível" "$saida"
assert_not_contains "não imprime um build vazio" "build instalado: (" "$saida"

echo
if [ "$fail" -eq 0 ]; then
  echo "OK: $total asserções passaram"
  exit 0
fi
echo "FALHOU: $fail de $total asserções"
exit 1
