#!/usr/bin/env bash
# Testes da reconfiguração do pendrive no install.sh.
#
# Por que existe: o ponto de montagem de um pendrive depende do rótulo do
# sistema de arquivos. Reformatar ou trocar de pendrive muda o caminho, e o
# valor antigo continua no arquivo de segredos parecendo configuração boa.
#
# A versão anterior desta função tratava "tem valor" como "está certo" e
# retornava sem olhar nada — então rodar o instalador de novo não consertava,
# e o backup seguia falhando toda noite apontando para um caminho que não
# existe. Aconteceu de verdade, no notebook do clube, depois de o pendrive ser
# reformatado e mudar de rótulo.
#
# Uso: bash scripts/test/install-usb-reconfig.test.sh
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

fail=0
total=0

assert_contains() {
  local desc="$1" needle="$2" haystack="$3"
  total=$((total + 1))
  if [[ "$haystack" == *"$needle"* ]]; then echo "  ok - $desc"
  else
    echo "  FALHOU - $desc"; echo "      esperava: [$needle]"
    printf '%s\n' "$haystack" | tail -20 | sed 's/^/        /'
    fail=$((fail + 1))
  fi
}
assert_eq() {
  local desc="$1" esperado="$2" obtido="$3"
  total=$((total + 1))
  if [ "$esperado" = "$obtido" ]; then echo "  ok - $desc"
  else echo "  FALHOU - $desc (esperado [$esperado], obtido [$obtido])"; fail=$((fail + 1)); fi
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

preparar() {
  local caminho_configurado="$1"
  rm -rf "$TMP/env"
  mkdir -p "$TMP"/{home,config,systemd,node,logind,backups,data,pen-novo,pen-velho}
  cp -r "$REPO_ROOT"/{dist,server,scripts,deploy,package.json} "$TMP/home/" 2>/dev/null
  [ -f "$REPO_ROOT/producao-info.json" ] && cp "$REPO_ROOT/producao-info.json" "$TMP/home/"
  printf "BAR_PIN_HASH='scrypt\$aa\$bb'\nBAR_SESSION_SECRET='cc'\nBAR_BACKUP_USB_PATH='%s'\n" \
    "$caminho_configurado" > "$TMP/config/env"
  chmod 600 "$TMP/config/env"
}

instalar() {
  MOTOCLUB_HOME_DIR="$TMP/home" MOTOCLUB_CONFIG_DIR="$TMP/config" MOTOCLUB_ENV_FILE="$TMP/config/env" \
  BAR_DB_PATH="$TMP/data/bar.sqlite3" BAR_BACKUP_DIR="$TMP/backups" \
  MOTOCLUB_SYSTEMD_USER_DIR="$TMP/systemd" MOTOCLUB_NODE_INSTALL_ROOT="$TMP/node" \
  MOTOCLUB_LOGIND_DROPIN_DIR="$TMP/logind" MOTOCLUB_SKIP_SYSTEMCTL=1 \
  MOTOCLUB_INSTALL_USB_PATH="$1" \
    bash "$TMP/home/scripts/install.sh" 2>&1
}

valor_configurado() {
  grep '^BAR_BACKUP_USB_PATH=' "$TMP/config/env" | sed "s/^BAR_BACKUP_USB_PATH=//; s/^'//; s/'$//"
}

echo
echo "caminho configurado que NÃO existe mais: detecta e reconfigura"
preparar "/media/fulano/PENDRIVE-QUE-SUMIU"
saida="$(instalar "$TMP/pen-novo")"
assert_contains "avisa que o configurado não está acessível" "não está acessível" "$saida"
assert_contains "diz o motivo provável" "trocado, reformatado ou está desconectado" "$saida"
assert_contains "confirma a reconfiguração" "pendrive reconfigurado" "$saida"
assert_eq "grava o caminho novo" "$TMP/pen-novo" "$(valor_configurado)"
assert_eq "deixa UMA linha, não duas" "1" "$(grep -c '^BAR_BACKUP_USB_PATH=' "$TMP/config/env")"
assert_eq "preserva PIN e segredo" "2" "$(grep -c '^BAR_PIN_HASH=\|^BAR_SESSION_SECRET=' "$TMP/config/env")"
assert_eq "mantém a permissão 600" "600" "$(stat -c%a "$TMP/config/env")"

echo
echo "caminho configurado que EXISTE e é gravável: não mexe em nada"
preparar "$TMP/pen-velho"
antes="$(cat "$TMP/config/env")"
saida="$(instalar "$TMP/pen-novo")"
assert_contains "reconhece como já configurado" "já configurado" "$saida"
assert_eq "não reconfigurou" "$TMP/pen-velho" "$(valor_configurado)"
assert_eq "arquivo de segredos inalterado" "$antes" "$(cat "$TMP/config/env")"

echo
echo "caminho existe mas NÃO é gravável: avisa o motivo certo"
preparar "$TMP/pen-somente-leitura"
mkdir -p "$TMP/pen-somente-leitura"; chmod 500 "$TMP/pen-somente-leitura"
saida="$(instalar "$TMP/pen-novo")"
assert_contains "distingue 'existe mas não grava' de 'não existe'" "não é gravável" "$saida"
chmod 700 "$TMP/pen-somente-leitura"

echo
if [ "$fail" -eq 0 ]; then echo "OK: $total asserções passaram"; exit 0; fi
echo "FALHOU: $fail de $total asserções"
exit 1
