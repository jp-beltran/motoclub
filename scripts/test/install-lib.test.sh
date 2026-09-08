#!/usr/bin/env bash
# Testes de funções isoladas de scripts/install.sh.
#
# install.sh é `source`ado, não executado — o guard no fim do arquivo
# (`if [ "${BASH_SOURCE[0]}" = "${0}" ]`) impede que main() rode quando o
# arquivo é lido assim, o que é o que torna possível testar uma função por
# vez sem disparar a instalação inteira (Node, systemd, segredos...).
#
# Uso: bash scripts/test/install-lib.test.sh
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# install.sh roda `set -euo pipefail` assim que é lido — sourcing propaga
# isso para este shell também. Voltamos para um modo que deixa as
# asserções seguirem rodando depois de uma falhar, do mesmo jeito que
# version.test.sh já faz.
# shellcheck source=../install.sh
source "$SCRIPT_DIR/../install.sh"
set +e
set -u

fail=0
total=0

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

assert_true() {
  local desc="$1"
  shift
  total=$((total + 1))
  if "$@" >/dev/null 2>&1; then
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
  if ! "$@" >/dev/null 2>&1; then
    echo "  ok - $desc"
  else
    echo "  FALHOU - $desc (esperava falso: $*)"
    fail=$((fail + 1))
  fi
}

echo "prompt_usb_path"

# Regressão do bug C1: a função escrevia a mensagem de sucesso ("ok ...")
# no MESMO stdout de onde os dois chamadores capturam o valor de retorno
# com "$(...)". Sem o ">&2" na mensagem, o valor capturado virava
# "  OK  pendrive verificado e gravável em /media/x\n/media/x" em vez de
# só "/media/x" — e essa string quebrada é o que ia parar dentro de
# BAR_BACKUP_USB_PATH no arquivo de segredos.
USB_DIR="$(mktemp -d)"
CAPTURED="$(MOTOCLUB_INSTALL_USB_PATH="$USB_DIR" prompt_usb_path 2>/dev/null)"
assert_eq "caminho válido: prompt_usb_path emite exatamente o caminho, nada mais" "$USB_DIR" "$CAPTURED"

# A mesma checagem, mas confirmando que a mensagem de sucesso realmente
# existe (só que em stderr, não em stdout) — se alguém remover a mensagem
# em vez de só redirecioná-la, este teste continua passando, mas o de
# cima pega qualquer regressão de "foi para stdout de novo".
CAPTURED_STDERR="$(MOTOCLUB_INSTALL_USB_PATH="$USB_DIR" prompt_usb_path 2>&1 >/dev/null)"
total=$((total + 1))
if echo "$CAPTURED_STDERR" | grep -q "OK"; then
  echo "  ok - a mensagem de sucesso vai para stderr, não para stdout"
else
  echo "  FALHOU - esperava alguma mensagem 'OK' em stderr, não achei: $CAPTURED_STDERR"
  fail=$((fail + 1))
fi
rm -rf "$USB_DIR"

# Caminho vazio (pular o pendrive) -> stdout vazio, nada mais.
CAPTURED_EMPTY="$(MOTOCLUB_INSTALL_USB_PATH="" prompt_usb_path 2>/dev/null)"
assert_eq "caminho vazio (pular): stdout vazio" "" "$CAPTURED_EMPTY"

# Caminho configurado mas inexistente (pendrive não montado) -> também
# stdout vazio; o aviso vai para stderr.
CAPTURED_MISSING="$(MOTOCLUB_INSTALL_USB_PATH="/caminho/que/definitivamente/nao/existe/xyz123" prompt_usb_path 2>/dev/null)"
assert_eq "caminho inexistente: stdout vazio" "" "$CAPTURED_MISSING"

echo "is_valid_pin"
assert_true "1234 é válido (4 dígitos)" is_valid_pin "1234"
assert_true "123456 é válido (mais de 4 dígitos)" is_valid_pin "123456"
assert_false "123 é inválido (menos de 4 dígitos)" is_valid_pin "123"
assert_false "abcd é inválido (não são dígitos, mesmo com 4 caracteres)" is_valid_pin "abcd"
assert_false "12a4 é inválido (mistura letra)" is_valid_pin "12a4"
assert_false "string vazia é inválida" is_valid_pin ""

echo
if [ "$fail" -eq 0 ]; then
  echo "OK: $total asserções passaram"
  exit 0
else
  echo "FALHA: $fail de $total asserções falharam"
  exit 1
fi
