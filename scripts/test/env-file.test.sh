#!/usr/bin/env bash
# Testes de scripts/lib/env-file.sh — o leitor/escritor do arquivo de segredos.
# Uso: bash scripts/test/env-file.test.sh
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/env-file.sh
source "$SCRIPT_DIR/../lib/env-file.sh"

fail=0
total=0

assert_eq() {
  local desc="$1" expected="$2" actual="$3"
  total=$((total + 1))
  if [ "$expected" = "$actual" ]; then
    echo "  ok - $desc"
  else
    echo "  FALHOU - $desc"
    echo "      esperado: [$expected]"
    echo "      obtido:   [$actual]"
    fail=$((fail + 1))
  fi
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
ENVF="$TMP/env"

echo
echo "env_file_var: formato ANTIGO (sem aspas) continua entendido"
# Uma instalação que já existe tem o arquivo sem aspas, e o install.sh
# nunca o reescreve para não rotacionar um PIN que funciona. Então este
# caso precisa funcionar para sempre, não só na transição.
printf 'BAR_DB_PATH=/home/bar/.local/share/motoclub/bar.sqlite3\n' > "$ENVF"
assert_eq "valor simples sem aspas" \
  "/home/bar/.local/share/motoclub/bar.sqlite3" "$(env_file_var "$ENVF" BAR_DB_PATH)"

echo
echo "env_file_var: formato NOVO (aspas simples) tem as aspas removidas"
printf "BAR_DB_PATH='/home/bar/dados/bar.sqlite3'\n" > "$ENVF"
assert_eq "aspas simples removidas" \
  "/home/bar/dados/bar.sqlite3" "$(env_file_var "$ENVF" BAR_DB_PATH)"

printf 'BAR_DB_PATH="/home/bar/dados/bar.sqlite3"\n' > "$ENVF"
assert_eq "aspas duplas removidas" \
  "/home/bar/dados/bar.sqlite3" "$(env_file_var "$ENVF" BAR_DB_PATH)"

echo
echo "env_file_var: o caso que motivou tudo — valor com '\$'"
HASH='scrypt$5da6fc4a35a55ef6$f17e12631d6fbeeabfff5a54'
printf "BAR_PIN_HASH='%s'\n" "$HASH" > "$ENVF"
assert_eq "hash scrypt com \$ sobrevive inteiro" "$HASH" "$(env_file_var "$ENVF" BAR_PIN_HASH)"

printf 'BAR_PIN_HASH=%s\n' "$HASH" > "$ENVF"
assert_eq "hash scrypt sem aspas também sobrevive (o leitor não expande)" \
  "$HASH" "$(env_file_var "$ENVF" BAR_PIN_HASH)"

echo
echo "env_file_var: casos que quebram parser ingênuo"
printf 'BAR_BACKUP_USB_PATH=/media/bar/pendrive=1\n' > "$ENVF"
assert_eq "valor com '=' não é truncado" \
  "/media/bar/pendrive=1" "$(env_file_var "$ENVF" BAR_BACKUP_USB_PATH)"

printf 'BAR_PORT=8787\nBAR_PORT=9999\n' > "$ENVF"
assert_eq "variável repetida: vale a última (semântica do systemd)" \
  "9999" "$(env_file_var "$ENVF" BAR_PORT)"

printf 'BAR_HOST=127.0.0.1\n' > "$ENVF"
assert_eq "variável ausente devolve vazio, sem erro" "" "$(env_file_var "$ENVF" BAR_PORT)"
assert_eq "arquivo ausente devolve vazio, sem erro" "" "$(env_file_var "$TMP/nao-existe" BAR_PORT)"

printf 'BAR_BACKUP_USB_PATH=\n' > "$ENVF"
assert_eq "valor vazio devolve vazio" "" "$(env_file_var "$ENVF" BAR_BACKUP_USB_PATH)"

printf 'BAR_PORTAL=xxx\nBAR_PORT=8787\n' > "$ENVF"
assert_eq "não casa prefixo de outra variável (BAR_PORTAL vs BAR_PORT)" \
  "8787" "$(env_file_var "$ENVF" BAR_PORT)"

printf "BAR_HOST=o'reilly\n" > "$ENVF"
assert_eq "aspa simples só de um lado não é removida" \
  "o'reilly" "$(env_file_var "$ENVF" BAR_HOST)"

echo
echo "env_file_line: escreve na forma que systemd e shell leem igual"
assert_eq "valor simples ganha aspas simples" \
  "BAR_PORT='8787'" "$(env_file_line BAR_PORT 8787)"
assert_eq "valor com \$ ganha aspas simples" \
  "BAR_PIN_HASH='$HASH'" "$(env_file_line BAR_PIN_HASH "$HASH")"

echo
echo "env_file_line: valor com apóstrofo é RECUSADO, não adivinhado"
# Não existe escape de apóstrofo que systemd e shell leiam igual
# (medido: o systemd devolve o''reilly' onde o shell devolve o'reilly).
# Então a função recusa em vez de gravar algo ambíguo.
saida="$(env_file_line BAR_HOST "o'reilly" 2>/dev/null)"; rc=$?
assert_eq "sai com código 1" "1" "$rc"
assert_eq "não imprime linha nenhuma no stdout" "" "$saida"
# Casamento nativo do bash em vez de grep: o teste não deve depender de
# qual implementação de grep está no PATH de quem roda.
erro="$(env_file_line BAR_HOST "o'reilly" 2>&1 >/dev/null)"
assert_eq "a explicação vai para o stderr e nomeia a variável" "sim" \
  "$([[ "$erro" == *BAR_HOST* ]] && echo sim || echo nao)"
assert_eq "a explicação diz qual é o motivo" "sim" \
  "$([[ "$erro" == *apóstrofo* ]] && echo sim || echo nao)"

echo
echo "ida e volta: o que env_file_line escreve, env_file_var lê de volta idêntico"
for valor in \
  "8787" \
  "$HASH" \
  "/media/bar/pen drive" \
  "/media/bar/pendrive=1" \
  "scrypt\$a\$b" \
  "/media/bar/BACKUP DO MOTOCLUB"
do
  env_file_line BAR_TESTE "$valor" > "$ENVF"
  printf '\n' >> "$ENVF"
  assert_eq "ida e volta: [$valor]" "$valor" "$(env_file_var "$ENVF" BAR_TESTE)"
done

echo
echo "ida e volta pelo SHELL: 'source' devolve o valor intacto"
# É este o cenário do operador depurando no notebook. Sem as aspas, o
# shell entrega 'scrypt' e nenhum aviso.
env_file_line BAR_PIN_HASH "$HASH" > "$ENVF"
printf '\n' >> "$ENVF"
LIDO="$(set +u; . "$ENVF"; printf '%s' "$BAR_PIN_HASH")"
assert_eq "source no arquivo novo devolve o hash inteiro" "$HASH" "$LIDO"

echo
if [ "$fail" -eq 0 ]; then
  echo "OK: $total asserções passaram"
  exit 0
fi
echo "FALHOU: $fail de $total asserções"
exit 1
